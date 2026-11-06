import {
  ContainerStore,
  WidgetConnector,
  createTranslator,
  emptyContainerFilter,
  resolveTheme,
  type ContainerFilter,
  type ContainerPhase,
  type ContainerSnapshot,
  type ThemeName,
  type ThemeTokens,
  type Translator,
} from '@widgets/core';
import { findRegion, type HitRegion } from '@widgets/render';
import {
  createContainerGridTransport,
  isStaticSource,
  resolveConfig,
  type ContainerGridConfig,
  type WidgetSource,
} from './config';
import {
  computeGridLayout,
  computeGridWindow,
  maxGridScroll,
  type GridLayout,
  type GridSectionId,
} from './layout';
import { renderContainerGrid } from './renderer';
import { buildContainerGridViewModel, type ContainerGridViewModel } from './view-model';

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
 * `<container-grid>` — responsive pod/service health grid.
 *
 * Same host contract as the other widgets: it can stream from the network on its
 * own, or receive `ContainerSnapshot` batches from a native bridge with
 * `appendBatch()`.
 */
export class ContainerGridElement extends HTMLElementBase() {
  static readonly tagName = 'container-grid';
  static readonly observedAttributes = [
    'src',
    'transport',
    'theme',
    'locale',
    'columns',
    'interval',
    'phase',
    'namespace',
    'query',
    'attention',
    'sort',
  ];

  static readonly ACTION_EVENT = 'widget-action';
  static readonly SNAPSHOT_EVENT = 'widget-snapshot';
  static readonly TRANSITION_EVENT = 'widget-transition';
  static readonly SELECT_EVENT = 'widget-select';
  static readonly ERROR_EVENT = 'widget-error';

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private container: HTMLDivElement | null = null;
  private search: HTMLInputElement | null = null;
  private liveRegion: HTMLDivElement | null = null;
  private description: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private frame = 0;

  private store: ContainerStore | null = null;
  private connector: WidgetConnector<ContainerSnapshot> | null = null;
  private staticTransport: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: Array<() => void> = [];

  private config = resolveConfig();
  private theme: ThemeTokens = resolveTheme('dark');
  private translator: Translator = createTranslator('en');
  private layout: GridLayout | null = null;
  private vm: ContainerGridViewModel | null = null;
  private regions: HitRegion[] = [];
  private hovered: HitRegion | null = null;
  private pointer = { x: 0, y: 0 };
  private dragging = false;
  private dragStart = { y: 0, scrollOffset: 0 };
  private started = false;

  private filters: ContainerFilter = { ...emptyContainerFilter };
  private selectionId: string | null = null;
  private scrollOffset = 0;
  private manualSnapshot: ContainerSnapshot | null = null;


  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connectedCallback(): void {
    if (this.started) return;
    this.started = true;
    this.upgradeConfigFromAttributes();
    this.buildDom();
    this.applyTheme();

    this.store = new ContainerStore({
      maxContainers: this.config.maxContainers,
      historySize: this.config.historySize,
    });
    this.filters = { ...this.filters, ...this.config.filters };

    this.unsubscribers.push(
      this.store.on('update', () => this.scheduleRender()),
      this.store.on('reset', () => {
        this.selectionId = null;
        this.scrollOffset = 0;
        this.scheduleRender();
      }),
      this.store.on('transition', (payload) => {
        this.dispatchEvent(new CustomEvent(ContainerGridElement.TRANSITION_EVENT, { detail: payload }));
        this.announce(
          `${payload.container.name} ${payload.from} → ${payload.to} in ${payload.container.namespace}`,
        );
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
  setConfig(config: ContainerGridConfig): void {
    const sourceChanged = config.source !== undefined;
    this.config = resolveConfig({ ...this.config, ...config });
    this.translator = createTranslator(this.config.locale, this.config.messages);
    this.applyTheme();
    if (config.filters) this.filters = { ...this.filters, ...config.filters };
    if (sourceChanged) this.startSource();
    this.scheduleRender();
  }

  /** Push a fleet snapshot from a native bridge or your own data layer. */
  appendBatch(snapshot: ContainerSnapshot): void {
    this.manualSnapshot = snapshot;
    this.store?.update(snapshot);
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

  clear(): void {
    this.store?.clear();
  }

  // ── Public state ──────────────────────────────────────────────────────────

  get snapshot(): ContainerSnapshot | null {
    const store = this.store;
    if (!store) return null;
    return { timestamp: Date.now(), containers: store.all(), mode: 'replace' };
  }

  get filter(): ContainerFilter {
    return {
      ...this.filters,
      phases: [...this.filters.phases],
      namespaces: [...this.filters.namespaces],
    };
  }

  set filter(next: Partial<ContainerFilter>) {
    this.filters = { ...this.filters, ...next };
    this.syncSearchInput();
    this.scrollOffset = 0;
    this.scheduleRender();
  }

  get selectedId(): string | null {
    return this.selectionId;
  }

  get viewModel(): ContainerGridViewModel | null {
    return this.vm;
  }

  get currentLayout(): GridLayout | null {
    return this.layout;
  }

  get hitRegions(): readonly HitRegion[] {
    return this.regions;
  }

  /** Number of tracked containers (before filtering). */
  get containerCount(): number {
    return this.store?.size ?? 0;
  }

  /** Copies the filtered fleet state as newline separated text. */
  async copyState(): Promise<boolean> {
    const rows = this.visibleContainers();
    const text = rows
      .map(
        (entry) =>
          `${entry.namespace}/${entry.name} ${entry.phase} ${entry.health} cpu=${entry.cpu.used.toFixed(2)} mem=${entry.memory.used} restarts=${entry.spec.restarts}`,
      )
      .join('\n');
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
    this.canvas.setAttribute('role', 'grid');
    this.canvas.tabIndex = 0;
    this.canvas.style.outline = 'none';

    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.className = 'search';
    this.search.setAttribute('aria-label', 'Filter workloads');
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
      if (region && region.action !== 'select-card') this.activate(region);
    });

    canvas.addEventListener('pointerup', (event) => {
      const point = this.toCanvasSpace(event);
      const moved = Math.abs(this.dragStart.y - point.y) > 4;
      if (!moved) {
        const region = findRegion(this.regions, point.x, point.y);
        if (region?.action === 'select-card') this.activate(region);
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


  /** 2D keyboard navigation across the card grid. */
  private handleKeydown(event: KeyboardEvent): void {
    const columns = Math.max(1, this.layout?.grid.columns ?? 1);
    const total = this.visibleContainers().length;
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        this.moveSelection(1, total);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.moveSelection(-1, total);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.moveSelection(columns, total);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.moveSelection(-columns, total);
        break;
      case 'PageDown':
        event.preventDefault();
        this.moveSelection(columns * Math.max(1, this.layout?.grid.visibleRows ?? 1), total);
        break;
      case 'PageUp':
        event.preventDefault();
        this.moveSelection(-columns * Math.max(1, this.layout?.grid.visibleRows ?? 1), total);
        break;
      case 'Home':
        event.preventDefault();
        this.selectIndex(0);
        break;
      case 'End':
        event.preventDefault();
        this.selectIndex(total - 1);
        break;
      case '/':
        event.preventDefault();
        this.search?.focus();
        break;
      case 'a':
      case 'A':
        event.preventDefault();
        this.toggleAttention();
        break;
      case 'Escape':
        this.selectionId = null;
        this.scheduleRender();
        break;
      default:
        break;
    }
  }

  private visibleContainers() {
    return this.store?.filtered(this.filters) ?? [];
  }

  private moveSelection(delta: number, total: number): void {
    const rows = this.visibleContainers();
    const current = this.selectionId ? rows.findIndex((entry) => entry.id === this.selectionId) : -1;
    if (current < 0) {
      this.selectIndex(delta >= 0 ? 0 : Math.max(0, total - 1));
      return;
    }
    this.selectIndex(current + delta);
  }

  private selectIndex(index: number): void {
    const rows = this.visibleContainers();
    if (rows.length === 0) return;
    const clamped = Math.max(0, Math.min(index, rows.length - 1));
    const entry = rows[clamped];
    if (!entry) return;
    this.selectionId = entry.id;
    this.ensureVisible(clamped);
    this.announce(`${entry.namespace}/${entry.name} ${entry.phase}, ${entry.health}`);
    this.dispatchEvent(
      new CustomEvent(ContainerGridElement.SELECT_EVENT, { detail: entry, bubbles: true, composed: true }),
    );
    this.scheduleRender();
  }

  /** Scrolls so the card's row is inside the grid viewport. */
  private ensureVisible(index: number): void {
    const layout = this.layout;
    if (!layout) return;
    const gridRect = layout.sections.grid;
    if (!gridRect) return;
    const row = Math.floor(index / Math.max(1, layout.grid.columns));
    const cardTop = row * layout.grid.rowStride;
    const cardBottom = cardTop + layout.grid.rowStride;
    if (cardTop < this.scrollOffset) this.setScroll(cardTop - layout.grid.rowStride * 0.4);
    else if (cardBottom > this.scrollOffset + gridRect.height) this.setScroll(cardBottom - gridRect.height);
  }

  private setScroll(next: number): void {
    const layout = this.layout;
    if (!layout) return;
    const gridRect = layout.sections.grid;
    const total = this.visibleContainers().length;
    const max = maxGridScroll(total, layout.grid, gridRect?.height ?? 320);
    const clamped = Math.max(0, Math.min(next, max));
    if (clamped !== this.scrollOffset) {
      this.scrollOffset = clamped;
      this.scheduleRender();
    }
  }


  /** Runs a hit-region action (pointer click or keyboard activation). */
  private activate(region: HitRegion): void {
    const action = region.action ?? region.id;
    if (action.startsWith('filter-phase:')) {
      this.togglePhase(action.slice('filter-phase:'.length) as ContainerPhase | 'all');
    } else if (action.startsWith('filter-namespace:')) {
      this.toggleNamespace(action.slice('filter-namespace:'.length));
    } else if (action === 'select-card') {
      const id = (region.payload as { id?: string } | undefined)?.id;
      const rows = this.visibleContainers();
      const index = id ? rows.findIndex((entry) => entry.id === id) : -1;
      if (index >= 0) this.selectIndex(index);
    } else if (action === 'attention') {
      this.toggleAttention();
    } else if (action === 'refresh') {
      this.refresh();
    } else if (action === 'reset') {
      this.filters = { ...this.filters, phases: [], namespaces: [], query: '', attentionOnly: false };
      this.syncSearchInput();
      this.scheduleRender();
    } else if (action === 'copy') {
      void this.copyState();
    }

    this.config.onAction?.(action, region.payload);
    this.dispatchEvent(
      new CustomEvent(ContainerGridElement.ACTION_EVENT, {
        detail: { action, payload: region.payload },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private toggleAttention(): void {
    this.filters = { ...this.filters, attentionOnly: !(this.filters.attentionOnly ?? false) };
    this.scrollOffset = 0;
    this.scheduleRender();
  }

  private togglePhase(phase: ContainerPhase | 'all'): void {
    if (phase === 'all') {
      this.filters = { ...this.filters, phases: [] };
    } else {
      const phases = new Set(this.filters.phases);
      if (phases.has(phase)) phases.delete(phase);
      else phases.add(phase);
      this.filters = { ...this.filters, phases: [...phases] };
    }
    this.scrollOffset = 0;
    this.scheduleRender();
  }

  private toggleNamespace(namespace: string): void {
    const namespaces = new Set(this.filters.namespaces);
    if (namespaces.has(namespace)) namespaces.delete(namespace);
    else namespaces.add(namespace);
    this.filters = { ...this.filters, namespaces: [...namespaces] };
    this.scrollOffset = 0;
    this.scheduleRender();
  }

  /** Announces a message to assistive technology (health transitions, selection). */
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
        if (snapshot) this.store?.update(snapshot);
      };
      push();
      this.staticTransport = setInterval(push, 3000);
      return;
    }

    const transport = createContainerGridTransport(source, () => this.manualSnapshot);
    if (!transport) return;
    this.connector = new WidgetConnector<ContainerSnapshot>(transport, this.store);
    this.connector.on('snapshot', (snapshot) => {
      this.dispatchEvent(new CustomEvent(ContainerGridElement.SNAPSHOT_EVENT, { detail: snapshot }));
    });
    this.connector.on('status', () => this.scheduleRender());
    this.connector.on('error', (error) => {
      this.config.onError?.(error);
      this.dispatchEvent(new CustomEvent(ContainerGridElement.ERROR_EVENT, { detail: error }));
    });
    void this.connector.start().catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.config.onError?.(err);
      this.dispatchEvent(new CustomEvent(ContainerGridElement.ERROR_EVENT, { detail: err }));
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
    return Number.isFinite(raw) && raw >= 500 ? raw : 3000;
  }

  private upgradeConfigFromAttributes(): void {
    const patch: ContainerGridConfig = {};
    const theme = this.getAttribute('theme');
    if (theme === 'dark' || theme === 'light') patch.theme = theme as ThemeName;
    const locale = this.getAttribute('locale');
    if (locale) patch.locale = locale;
    const columns = this.getAttribute('columns');
    if (columns === '1' || columns === '2') patch.columns = Number(columns) as 1 | 2;
    const sort = this.getAttribute('sort');
    if (sort === 'severity' || sort === 'name' || sort === 'restarts' || sort === 'cpu' || sort === 'memory') {
      patch.sort = sort;
    }
    this.config = resolveConfig({ ...this.config, ...patch });
    this.translator = createTranslator(this.config.locale, this.config.messages);

    const phase = this.getAttribute('phase');
    if (phase) {
      this.filters = {
        ...this.filters,
        phases: phase
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter((value): value is ContainerPhase => value.length > 0),
      };
    }
    const namespace = this.getAttribute('namespace');
    if (namespace) {
      this.filters = {
        ...this.filters,
        namespaces: namespace.split(',').map((value) => value.trim()).filter(Boolean),
      };
    }
    const query = this.getAttribute('query');
    if (query !== null) this.filters = { ...this.filters, query };
    const attention = this.getAttribute('attention');
    if (attention === 'true') this.filters = { ...this.filters, attentionOnly: true };
    if (attention === 'false') this.filters = { ...this.filters, attentionOnly: false };
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

    const cssWidth = Math.max(1, this.clientWidth || container.clientWidth || 1020);
    const cssHeight = Math.max(1, this.clientHeight || container.clientHeight || 660);

    this.layout = computeGridLayout({
      width: cssWidth,
      height: cssHeight,
      ...(this.config.columns ? { columns: this.config.columns } : {}),
      breakpoint: this.config.breakpoint,
      cardMinWidth: this.config.cardMinWidth,
      cardHeight: this.config.cardHeight,
      cardGap: this.config.cardGap,
      ...(this.config.padding != null ? { padding: this.config.padding } : {}),
      ...(this.config.gap != null ? { gap: this.config.gap } : {}),
      hidden: hiddenSectionIds(this.config.sections),
    });

    const store = this.store;
    const filteredTotal = store ? store.filtered(this.filters).length : 0;
    const gridRect = this.layout.sections.grid;
    const max = maxGridScroll(filteredTotal, this.layout.grid, gridRect?.height ?? 320);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, max));

    const gridWindow = computeGridWindow(this.layout.grid, filteredTotal, this.scrollOffset, 1);

    this.vm = store
      ? buildContainerGridViewModel({
          store,
          theme: this.theme,
          t: this.translator,
          filters: this.filters,
          selectionId: this.selectionId,
          scrollTop: this.scrollOffset,
          first: gridWindow.first,
          count: gridWindow.count,
          columns: this.layout.grid.columns,
          cardWidth: this.layout.grid.cardWidth,
          sort: this.config.sort,
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
    const result = renderContainerGrid(ctx, {
      theme: this.theme,
      layout: this.layout,
      vm: this.vm,
      cardHeight: this.config.cardHeight,
      cardGap: this.config.cardGap,
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
    if (!this.config.searchable || layout.width < 420) {
      input.style.display = 'none';
      return;
    }
    const toolbar = layout.toolbar;
    const narrow = layout.width < 700;
    const height = Math.max(20, Math.min(30, toolbar.height - 12));
    const width = Math.max(narrow ? 120 : 150, Math.min(narrow ? toolbar.width * 0.28 : 250, toolbar.width * 0.2));
    const x = toolbar.x + toolbar.width * (narrow ? 0.38 : 0.42);
    const y = toolbar.y + (toolbar.height - height) / 2;
    input.style.display = 'block';
    input.style.left = `${Math.round(x)}px`;
    input.style.top = `${Math.round(y)}px`;
    input.style.width = `${Math.round(width)}px`;
    input.style.height = `${Math.round(height)}px`;
    input.placeholder = 'Filter workloads…';
  }

  private syncSearchInput(): void {
    if (!this.search) return;
    if (this.search.value !== this.filters.query) this.search.value = this.filters.query;
  }

  private updateAccessibility(): void {
    if (!this.vm || !this.canvas || !this.description) return;
    const stats = this.store?.stats();
    const summary = [
      `${stats?.total ?? 0} workloads`,
      `${stats?.byPhase.running ?? 0} running`,
      `${stats?.byPhase.failed ?? 0} failed`,
      `${stats?.byHealth.warning ?? 0} warnings`,
      `${this.vm.cards.filteredTotal} shown`,
      this.vm.toolbar.connection.label,
    ].join(' · ');
    this.canvas.setAttribute('aria-label', 'Container fleet grid');
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

function hiddenSectionIds(sections: ContainerGridConfig['sections']): GridSectionId[] {
  return Object.entries(sections ?? {})
    .filter(([, enabled]) => enabled === false)
    .map(([id]) => id as GridSectionId);
}

export { createMockContainerSnapshot as mockContainerSnapshot } from '@widgets/core';

