import {
  LogStore,
  WidgetConnector,
  createTranslator,
  emptyLogFilter,
  resolveTheme,
  type LogEntry,
  type LogFilter,
  type LogLevel,
  type LogSnapshot,
  type ThemeName,
  type ThemeTokens,
  type Translator,
} from '@widgets/core';
import { findRegion, type HitRegion } from '@widgets/render';
import {
  createLogStreamTransport,
  isStaticSource,
  resolveConfig,
  type LogStreamConfig,
  type WidgetSource,
} from './config';
import {
  computeLogLayout,
  computeStreamWindow,
  maxScrollTop,
  type LogLayout,
  type LogSectionId,
} from './layout';
import { renderLogWidget } from './renderer';
import { buildLogViewModel, type LogViewModel } from './view-model';

/** Base class resolution keeps the element importable in Node (SSR, tests). */
export function HTMLElementBase(): typeof HTMLElement {
  if (typeof HTMLElement !== 'undefined') return HTMLElement;
  return class {
    dispatchEvent(): boolean {
      return true;
    }
    getAttribute(): string | null {
      return null;
    }
    setAttribute(): void {}
    removeAttribute(): void {}
  } as unknown as typeof HTMLElement;
}

/**
 * `<log-stream>` — virtualised, filterable live log viewer.
 *
 * Same host contract as `<server-monitor>`: it can stream from the network on its
 * own, or receive `LogSnapshot` batches from a native bridge with `append()`.
 */
export class LogStreamElement extends HTMLElementBase() {
  static readonly tagName = 'log-stream';
  static readonly observedAttributes = [
    'src',
    'transport',
    'theme',
    'locale',
    'columns',
    'interval',
    'level',
    'service',
    'query',
  ];

  static readonly ACTION_EVENT = 'widget-action';
  static readonly SNAPSHOT_EVENT = 'widget-snapshot';
  static readonly CRITICAL_EVENT = 'widget-critical';
  static readonly ERROR_EVENT = 'widget-error';
  static readonly SELECT_EVENT = 'widget-select';

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private container: HTMLDivElement | null = null;
  private search: HTMLInputElement | null = null;
  private liveRegion: HTMLDivElement | null = null;
  private description: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private frame = 0;

  private store: LogStore | null = null;
  private connector: WidgetConnector<LogSnapshot> | null = null;
  private staticTransport: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: Array<() => void> = [];

  private config = resolveConfig();
  private theme: ThemeTokens = resolveTheme('dark');
  private translator: Translator = createTranslator('en');
  private layout: LogLayout | null = null;
  private vm: LogViewModel | null = null;
  private regions: HitRegion[] = [];
  private hovered: HitRegion | null = null;
  private pointer = { x: 0, y: 0 };
  private dragging = false;
  private dragStart = { y: 0, scrollOffset: 0 };
  private started = false;

  private filters: LogFilter = { ...emptyLogFilter };
  private selectionId: string | null = null;
  private scrollOffset = 0;
  private follow = true;
  private manualSnapshot: LogSnapshot | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connectedCallback(): void {
    if (this.started) return;
    this.started = true;
    this.upgradeConfigFromAttributes();
    this.buildDom();
    this.applyTheme();

    this.store = new LogStore({
      maxEntries: this.config.maxEntries,
      bucketMs: this.config.bucketMs,
      bucketCount: this.config.bucketCount,
      collapseRepeats: this.config.collapseRepeats,
    });
    this.filters = { ...this.filters, ...this.config.filters };
    this.follow = this.config.follow;

    this.unsubscribers.push(
      this.store.on('append', () => this.scheduleRender()),
      this.store.on('reset', () => {
        this.selectionId = null;
        this.scrollOffset = 0;
        this.scheduleRender();
      }),
      this.store.on('critical', (entry) => {
        this.dispatchEvent(new CustomEvent(LogStreamElement.CRITICAL_EVENT, { detail: entry }));
        this.announce(`${entry.level.toUpperCase()} ${entry.service}: ${entry.message}`);
      }),
      this.store.on('stats', () => this.scheduleRender()),
    );

    this.startSource();
    this.observeResize();
  }

  disconnectedCallback(): void {
    this.teardown();
  }

  attributeChangedCallback(): void {
    if (!this.started) return;
    this.upgradeConfigFromAttributes();
    this.applyTheme();
    this.startSource();
    this.scheduleRender();
  }

  /** Apply a configuration (or a patch). Restarts the source when it changes. */
  setConfig(config: LogStreamConfig): void {
    const sourceChanged = config.source !== undefined;
    this.config = resolveConfig({ ...this.config, ...config });
    this.translator = createTranslator(this.config.locale, this.config.messages);
    this.applyTheme();
    if (config.filters) this.filters = { ...this.filters, ...config.filters };
    if (config.follow !== undefined) this.follow = config.follow;
    if (config.maxEntries !== undefined) this.store?.clear();
    if (sourceChanged) this.startSource();
    this.scheduleRender();
  }

  /** Push a batch of lines from a native bridge or your own data layer. */
  appendBatch(snapshot: LogSnapshot): void {
    this.manualSnapshot = snapshot;
    this.store?.update(snapshot);
  }

  /** Convenience for hosts that only have a single line. */
  appendLine(entry: LogEntry): void {
    this.store?.append([entry]);
  }

  refresh(): void {
    this.connector?.refresh();
  }

  stop(): void {
    this.connector?.stop();
    this.connector = null;
    if (this.staticTransport) {
      clearInterval(this.staticTransport);
      this.staticTransport = null;
    }
  }

  start(): void {
    this.startSource();
  }

  /** Clear the buffer (same as pressing the toolbar's clear action). */
  clear(): void {
    this.store?.clear();
  }

  // ── Public state ──────────────────────────────────────────────────────────

  get snapshot(): LogSnapshot | null {
    return this.store ? { timestamp: Date.now(), entries: this.store.entries() } : null;
  }

  get filter(): LogFilter {
    return { ...this.filters, levels: [...this.filters.levels], services: [...this.filters.services] };
  }

  set filter(next: Partial<LogFilter>) {
    this.filters = { ...this.filters, ...next };
    this.syncSearchInput();
    this.scheduleRender();
  }

  get selectedId(): string | null {
    return this.selectionId;
  }

  get viewModel(): LogViewModel | null {
    return this.vm;
  }

  get currentLayout(): LogLayout | null {
    return this.layout;
  }

  get hitRegions(): readonly HitRegion[] {
    return this.regions;
  }

  /** Number of buffered lines (all levels, before filtering). */
  get lineCount(): number {
    return this.store?.size ?? 0;
  }


  // ── DOM ───────────────────────────────────────────────────────────────────

  private buildDom(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = `
      :host { display: block; position: relative; contain: strict; }
      :host([hidden]) { display: none; }
      .frame { position: absolute; inset: 0; }
      canvas { display: block; width: 100%; height: 100%; touch-action: none; }
      .search { position: absolute; display: none; border-radius: 8px; border: 1px solid rgba(255,255,255,.14);
        background: rgba(10,15,25,.72); color: #f4f6fb; font: 500 12px Inter, "Segoe UI", system-ui, sans-serif;
        padding: 0 10px; outline: none; }
      .search:focus { border-color: rgba(47,123,246,.85); }
      .search::placeholder { color: rgba(244,246,251,.45); }
      .a11y { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
        overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
      .focus-ring { position: absolute; inset: 0; pointer-events: none;
        box-shadow: inset 0 0 0 2px transparent; transition: box-shadow .15s ease; }
      :host([data-focused='true']) .focus-ring { box-shadow: inset 0 0 0 2px rgba(47,123,246,.75); }
    `;

    this.container = document.createElement('div');
    this.container.className = 'frame';

    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'log');
    this.canvas.tabIndex = 0;
    this.canvas.style.outline = 'none';

    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.className = 'search';
    this.search.setAttribute('aria-label', 'Filter log lines');
    this.search.autocomplete = 'off';
    this.search.spellcheck = false;

    const focusRing = document.createElement('div');
    focusRing.className = 'focus-ring';

    this.description = document.createElement('div');
    this.description.className = 'a11y';

    this.liveRegion = document.createElement('div');
    this.liveRegion.className = 'a11y';
    this.liveRegion.setAttribute('role', 'status');
    this.liveRegion.setAttribute('aria-live', 'polite');

    this.container.append(this.canvas, this.search, focusRing, this.description, this.liveRegion);
    root.append(style, this.container);

    this.ctx = this.canvas.getContext('2d');
    this.bindInteractions();
  }

  private bindInteractions(): void {
    const canvas = this.canvas;
    const search = this.search;
    if (!canvas) return;

    search?.addEventListener('input', () => {
      this.filters = { ...this.filters, query: search.value };
      this.scrollOffset = 0;
      this.scheduleRender();
    });
    search?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        search.value = '';
        this.filters = { ...this.filters, query: '' };
        search.blur();
        this.scheduleRender();
      }
      event.stopPropagation();
    });

    canvas.addEventListener('pointermove', (event) => {
      const point = this.toCanvasSpace(event);
      this.pointer = point;
      if (this.dragging) {
        this.setScroll(this.dragStart.scrollOffset + (this.dragStart.y - point.y));
        return;
      }
      const region = findRegion(this.regions, point.x, point.y);
      if (region?.id !== this.hovered?.id) {
        this.hovered = region ?? null;
        canvas.style.cursor = region?.action ? 'pointer' : region ? 'help' : 'default';
      }
      this.scheduleRender();
    });

    canvas.addEventListener('pointerleave', () => {
      this.hovered = null;
      canvas.style.cursor = 'default';
      this.scheduleRender();
    });

    canvas.addEventListener('pointerdown', (event) => {
      const point = this.toCanvasSpace(event);
      this.dragging = true;
      this.dragStart = { y: point.y, scrollOffset: this.scrollOffset };
      const region = findRegion(this.regions, point.x, point.y);
      if (region && region.action !== 'select-row') this.activate(region);
    });

    canvas.addEventListener('pointerup', (event) => {
      const point = this.toCanvasSpace(event);
      const moved = Math.abs(this.dragStart.y - point.y) > 4;
      if (!moved) {
        const region = findRegion(this.regions, point.x, point.y);
        if (region?.action === 'select-row') this.activate(region);
        else if (!region) {
          this.selectionId = null;
          this.scheduleRender();
        }
      }
      this.dragging = false;
    });

    canvas.addEventListener('pointercancel', () => {
      this.dragging = false;
    });

    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.setScroll(this.scrollOffset + (event.deltaMode === 1 ? event.deltaY * 20 : event.deltaY));
      },
      { passive: false },
    );

    canvas.addEventListener('focus', () => this.setAttribute('data-focused', 'true'));
    canvas.addEventListener('blur', () => this.removeAttribute('data-focused'));
    canvas.addEventListener('keydown', (event) => this.handleKeydown(event));

    const onResize = () => this.observeResize();
    window.addEventListener('resize', onResize);
    this.unsubscribers.push(() => window.removeEventListener('resize', onResize));
  }

  private toCanvasSpace(event: PointerEvent | MouseEvent): { x: number; y: number } {
    const rect = this.canvas?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }


  private handleKeydown(event: KeyboardEvent): void {
    const rows = this.visibleRows().length;
    switch (event.key) {
      case 'ArrowDown':
      case 'j':
        event.preventDefault();
        this.moveSelection(1, rows);
        break;
      case 'ArrowUp':
      case 'k':
        event.preventDefault();
        this.moveSelection(-1, rows);
        break;
      case 'PageDown':
        event.preventDefault();
        this.moveSelection(this.rowsPerPage(), rows);
        break;
      case 'PageUp':
        event.preventDefault();
        this.moveSelection(-this.rowsPerPage(), rows);
        break;
      case 'Home':
        event.preventDefault();
        this.selectIndex(0, rows);
        break;
      case 'End':
        event.preventDefault();
        this.selectIndex(rows - 1, rows);
        break;
      case '/':
        event.preventDefault();
        this.search?.focus();
        break;
      case ' ':
        event.preventDefault();
        this.toggleFollow();
        break;
      case 'Escape':
        this.selectionId = null;
        this.scheduleRender();
        break;
      default:
        break;
    }
  }

  private rowsPerPage(): number {
    const height = this.layout?.sections.stream?.height ?? 320;
    return Math.max(1, Math.floor((height - 40) / this.config.rowHeight));
  }

  private visibleRows(): LogEntry[] {
    return this.store?.filtered(this.filters) ?? [];
  }

  private moveSelection(delta: number, total: number): void {
    const rows = this.visibleRows();
    const current = this.selectionId ? rows.findIndex((entry) => entry.id === this.selectionId) : -1;
    const next = current < 0 ? (delta > 0 ? 0 : rows.length - 1) : current + delta;
    this.selectIndex(next, total);
  }

  private selectIndex(index: number, total: number): void {
    const rows = this.visibleRows();
    if (rows.length === 0) return;
    const clamped = Math.max(0, Math.min(index, rows.length - 1));
    const entry = rows[clamped];
    if (!entry) return;
    this.selectionId = entry.id;
    this.ensureVisible(clamped);
    this.announce(`${entry.level.toUpperCase()} ${entry.service}: ${entry.message}`);
    this.dispatchEvent(
      new CustomEvent(LogStreamElement.SELECT_EVENT, { detail: entry, bubbles: true, composed: true }),
    );
    this.scheduleRender();
    void total;
  }

  /** Scrolls so the given row index is visible inside the stream viewport. */
  private ensureVisible(index: number): void {
    const viewport = this.streamViewportHeight();
    const rowTop = index * this.config.rowHeight;
    const rowBottom = rowTop + this.config.rowHeight;
    if (rowTop < this.scrollOffset) this.setScroll(rowTop - this.config.rowHeight * 0.5);
    else if (rowBottom > this.scrollOffset + viewport) this.setScroll(rowBottom - viewport);
  }

  private streamViewportHeight(): number {
    const rect = this.layout?.sections.stream;
    if (!rect) return 320;
    return Math.max(40, rect.height - 34);
  }

  private setScroll(next: number): void {
    const total = this.visibleRows().length;
    const max = maxScrollTop(total, this.config.rowHeight, this.streamViewportHeight());
    const clamped = Math.max(0, Math.min(next, max));
    const atBottom = max - clamped <= this.config.rowHeight * 0.5;
    if (clamped !== this.scrollOffset || atBottom !== this.follow) {
      this.scrollOffset = clamped;
      if (max - clamped > this.config.rowHeight) this.follow = false;
      else if (atBottom) this.follow = true;
      this.scheduleRender();
    }
  }

  private scrollToLatest(): void {
    const total = this.visibleRows().length;
    this.scrollOffset = maxScrollTop(total, this.config.rowHeight, this.streamViewportHeight());
    this.follow = true;
    this.scheduleRender();
  }

  private toggleFollow(): void {
    if (this.follow) {
      this.follow = false;
      this.scheduleRender();
      return;
    }
    this.scrollToLatest();
  }


  /** Runs a hit-region action (pointer click or keyboard activation). */
  private activate(region: HitRegion): void {
    const action = region.action ?? region.id;
    if (action.startsWith('filter-level:')) {
      this.toggleLevel(action.slice('filter-level:'.length) as LogLevel | 'all');
    } else if (action.startsWith('filter-service:')) {
      this.toggleService(action.slice('filter-service:'.length));
    } else if (action === 'select-row') {
      const id = (region.payload as { id?: string } | undefined)?.id;
      const rows = this.visibleRows();
      const index = id ? rows.findIndex((entry) => entry.id === id) : -1;
      if (index >= 0) this.selectIndex(index, rows.length);
    } else if (action === 'follow') {
      this.toggleFollow();
    } else if (action === 'jump-latest') {
      this.scrollToLatest();
    } else if (action === 'clear') {
      this.clear();
    } else if (action === 'copy') {
      void this.copySelection();
    }

    this.config.onAction?.(action, region.payload);
    this.dispatchEvent(
      new CustomEvent(LogStreamElement.ACTION_EVENT, {
        detail: { action, payload: region.payload },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private toggleLevel(level: LogLevel | 'all'): void {
    if (level === 'all') {
      this.filters = { ...this.filters, levels: [], minLevel: 'all' };
    } else {
      const levels = new Set(this.filters.levels);
      if (levels.has(level)) levels.delete(level);
      else levels.add(level);
      this.filters = { ...this.filters, levels: [...levels], minLevel: 'all' };
    }
    this.scrollOffset = 0;
    this.scheduleRender();
  }

  private toggleService(service: string): void {
    const services = new Set(this.filters.services);
    if (services.has(service)) services.delete(service);
    else services.add(service);
    this.filters = { ...this.filters, services: [...services] };
    this.scrollOffset = 0;
    this.scheduleRender();
  }

  /** Copies the selected line, or the whole filtered view, as plain text. */
  async copySelection(): Promise<boolean> {
    const rows = this.visibleRows();
    const selected = this.selectionId ? rows.find((entry) => entry.id === this.selectionId) : null;
    const format = (entry: LogEntry) =>
      `${new Date(entry.timestamp).toISOString()} ${entry.level.toUpperCase()} ${entry.service} ${entry.message}`;
    const text = selected ? format(selected) : rows.map(format).join('\n');
    try {
      const clipboard = (
        globalThis as { navigator?: { clipboard?: { writeText(value: string): Promise<void> } } }
      ).navigator?.clipboard;
      if (clipboard) await clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  private announce(message: string): void {
    if (!this.liveRegion || !message) return;
    this.liveRegion.textContent = message;
  }

  // ── Data source ───────────────────────────────────────────────────────────

  private startSource(): void {
    this.stop();
    if (!this.store) return;

    const source = this.resolveSource();
    if (isStaticSource(source)) {
      const getter = typeof source === 'function' ? source : () => this.manualSnapshot;
      const push = () => {
        const snapshot = getter();
        if (snapshot && snapshot.entries.length > 0) this.store?.update(snapshot);
      };
      push();
      this.staticTransport = setInterval(push, 2000);
      return;
    }

    const transport = createLogStreamTransport(source, () => this.manualSnapshot);
    if (!transport) return;
    this.connector = new WidgetConnector<LogSnapshot>(transport, this.store);
    this.connector.on('snapshot', (snapshot) => {
      this.dispatchEvent(new CustomEvent(LogStreamElement.SNAPSHOT_EVENT, { detail: snapshot }));
      if (this.follow) this.scrollToLatest();
    });
    this.connector.on('status', () => this.scheduleRender());
    this.connector.on('error', (error) => {
      this.config.onError?.(error);
      this.dispatchEvent(new CustomEvent(LogStreamElement.ERROR_EVENT, { detail: error }));
    });
    void this.connector.start().catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.config.onError?.(err);
      this.dispatchEvent(new CustomEvent(LogStreamElement.ERROR_EVENT, { detail: err }));
      this.scheduleRender();
    });
  }

  /** Attributes win over the programmatic config, so markup stays declarative. */
  private resolveSource(): WidgetSource {
    const src = this.getAttribute('src');
    if (src) {
      const transport = (this.getAttribute('transport') ?? 'auto').toLowerCase();
      if (transport === 'websocket') return { transport: 'websocket', url: src };
      if (transport === 'sse') return { transport: 'sse', url: src };
      if (transport === 'http') return { transport: 'http', url: src, intervalMs: this.intervalFromAttribute() };
      return src;
    }
    return this.config.source ?? null;
  }

  private intervalFromAttribute(): number {
    const raw = Number.parseInt(this.getAttribute('interval') ?? '', 10);
    return Number.isFinite(raw) && raw >= 250 ? raw : 1500;
  }

  private upgradeConfigFromAttributes(): void {
    const patch: LogStreamConfig = {};
    const theme = this.getAttribute('theme');
    if (theme === 'dark' || theme === 'light') patch.theme = theme as ThemeName;
    const locale = this.getAttribute('locale');
    if (locale) patch.locale = locale;
    const columns = this.getAttribute('columns');
    if (columns === '1' || columns === '2') patch.columns = Number(columns) as 1 | 2;
    const follow = this.getAttribute('follow');
    if (follow === 'false') patch.follow = false;
    if (follow === 'true') patch.follow = true;
    this.config = resolveConfig({ ...this.config, ...patch });
    this.translator = createTranslator(this.config.locale, this.config.messages);

    const level = this.getAttribute('level');
    if (level) {
      const levels = level
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter((value): value is LogLevel => value.length > 0);
      this.filters = { ...this.filters, levels, minLevel: 'all' };
    }
    const service = this.getAttribute('service');
    if (service) {
      this.filters = { ...this.filters, services: service.split(',').map((value) => value.trim()).filter(Boolean) };
    }
    const query = this.getAttribute('query');
    if (query !== null) this.filters = { ...this.filters, query };
  }

  private applyTheme(): void {
    this.theme = resolveTheme(this.config.theme, this.config.themeOverride);
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private scheduleRender(): void {
    if (this.frame) return;
    const request =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: () => void) => setTimeout(cb, 16) as unknown as number;
    this.frame = request(() => {
      this.frame = 0;
      this.paint();
    });
  }

  /** Paints one frame; also used directly by tests and host-driven repaints. */
  paint(): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const container = this.container;
    if (!canvas || !container) return;

    const cssWidth = Math.max(1, this.clientWidth || container.clientWidth || 900);
    const cssHeight = Math.max(1, this.clientHeight || container.clientHeight || 620);

    this.layout = computeLogLayout({
      width: cssWidth,
      height: cssHeight,
      ...(this.config.columns ? { columns: this.config.columns } : {}),
      breakpoint: this.config.breakpoint,
      ...(this.config.padding != null ? { padding: this.config.padding } : {}),
      ...(this.config.gap != null ? { gap: this.config.gap } : {}),
      hidden: hiddenSectionIds(this.config.sections),
    });

    const store = this.store;
    const filteredTotal = store ? store.filtered(this.filters).length : 0;
    const streamRect = this.layout.sections.stream;
    const viewportHeight = streamRect ? Math.max(40, streamRect.height - 34) : 320;
    const max = maxScrollTop(filteredTotal, this.config.rowHeight, viewportHeight);
    // Follow mode always shows the tail; otherwise keep the offset in range.
    this.scrollOffset = this.follow ? max : Math.max(0, Math.min(this.scrollOffset, max));

    const streamWindow = computeStreamWindow(
      streamRect ?? { x: 0, y: 0, width: 1, height: viewportHeight },
      this.config.rowHeight,
      filteredTotal,
      this.scrollOffset,
      this.config.overscanRows,
    );

    this.vm = store
      ? buildLogViewModel({
          store,
          theme: this.theme,
          t: this.translator,
          filters: this.filters,
          selectionId: this.selectionId,
          scrollTop: this.scrollOffset,
          follow: this.follow,
          rowHeight: this.config.rowHeight,
          first: streamWindow.first,
          count: streamWindow.count,
          connectionState: this.connector?.status.state ?? (this.staticTransport ? 'live' : 'idle'),
          hiddenSections: this.config.sections,
        })
      : null;

    this.positionSearchInput();
    this.updateAccessibility();

    if (!ctx || !this.vm) {
      this.regions = [];
      this.emitRender();
      return;
    }

    const dpr = Math.min(3, Math.max(1, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const result = renderLogWidget(ctx, {
      theme: this.theme,
      layout: this.layout,
      vm: this.vm,
      ...(this.hovered ? { hoverId: this.hovered.id } : {}),
      tooltip:
        this.hovered?.tooltip && this.config.tooltips
          ? { text: this.hovered.tooltip, x: this.pointer.x, y: this.pointer.y }
          : null,
    });

    this.regions = result.regions;
    this.emitRender();
  }

  private emitRender(): void {
    this.dispatchEvent(
      new CustomEvent('widget-render', {
        detail: { regions: this.regions, viewModel: this.vm, layout: this.layout },
      }),
    );
  }

  /** Keeps the DOM search field aligned with the toolbar's free area. */
  private positionSearchInput(): void {
    const input = this.search;
    const layout = this.layout;
    if (!input || !layout) return;
    if (!this.config.searchable || layout.width < 380) {
      input.style.display = 'none';
      return;
    }
    const toolbar = layout.toolbar;
    const narrow = layout.width < 640;
    const height = Math.max(20, Math.min(30, toolbar.height - 12));
    const width = Math.max(
      narrow ? 120 : 150,
      Math.min(narrow ? toolbar.width * 0.3 : 260, toolbar.width * 0.22),
    );
    const x = toolbar.x + toolbar.width * (narrow ? 0.4 : 0.44);
    const y = toolbar.y + (toolbar.height - height) / 2;
    input.style.display = 'block';
    input.style.left = `${Math.round(x)}px`;
    input.style.top = `${Math.round(y)}px`;
    input.style.width = `${Math.round(width)}px`;
    input.style.height = `${Math.round(height)}px`;
    input.placeholder = this.translator('log.search');
  }

  private syncSearchInput(): void {
    if (!this.search) return;
    if (this.search.value !== this.filters.query) this.search.value = this.filters.query;
  }

  private updateAccessibility(): void {
    if (!this.vm || !this.canvas || !this.description) return;
    const stats = this.store?.stats();
    const summary = [
      `${this.lineCount} lines buffered`,
      `${this.vm.stream.filteredTotal} shown`,
      `${stats?.byLevel.error ?? 0} errors`,
      `${stats?.byLevel.warn ?? 0} warnings`,
      this.vm.toolbar.connection.label,
    ].join(' · ');
    this.canvas.setAttribute('aria-label', 'Live log stream');
    this.canvas.setAttribute('aria-description', summary);
    if (this.description.textContent !== summary) this.description.textContent = summary;
  }

  private observeResize(): void {
    const host = this.container;
    if (!host) return;
    if (typeof ResizeObserver === 'undefined') {
      this.scheduleRender();
      return;
    }
    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
    }
    this.resizeObserver.disconnect();
    this.resizeObserver.observe(host);
    this.scheduleRender();
  }

  private teardown(): void {
    this.stop();
    if (this.frame) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    this.store?.dispose();
    this.store = null;
    this.regions = [];
    this.vm = null;
    this.started = false;
    const root = this.shadowRoot;
    if (root) root.innerHTML = '';
  }
}

function hiddenSectionIds(sections: LogStreamConfig['sections']): LogSectionId[] {
  return Object.entries(sections ?? {})
    .filter(([, enabled]) => enabled === false)
    .map(([id]) => id as LogSectionId);
}

export { createMockLogSnapshot as mockLogSnapshot } from '@widgets/core';


