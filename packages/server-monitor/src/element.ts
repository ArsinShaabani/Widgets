import {
  WidgetConnector,
  WidgetStore,
  createTranslator,
  createMockSnapshot,
  mergeThresholds,
  resolveTheme,
  type MetricHistory,
  type StatusLevel,
  type ThemeName,
  type ThemeOverride,
  type ThemeTokens,
  type ThresholdConfig,
  type Translator,
  type WidgetSnapshot,
} from '@widgets/core';
import { createTransport, isStaticSource, resolveConfig, type ServerMonitorConfig, type WidgetSource } from './config';
import { computeLayout, type LayoutResult, type SectionId } from './layout';
import { findRegion, type HitRegion } from './hit';
import { renderDashboard } from './renderer';
import { buildViewModel, type ViewModel } from './view-model';

/**
 * Base class resolution.
 *
 * The element must stay importable in Node (SSR, native bridges, unit tests),
 * where `HTMLElement` does not exist. In a browser/WebView this resolves to the
 * real `HTMLElement` and the custom element works exactly as expected.
 */
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
 * `<server-monitor>` — canvas rendered server dashboard web component.
 *
 * Runs unchanged in a browser, an Electron/Tauri window, a WinUI WebView2 host,
 * an Android WebView or a WKWebView. Hosts feed it through `config.source`,
 * attributes, or a live `WidgetSnapshot` pushed with `setSnapshot()`.
 */
export class ServerMonitorElement extends HTMLElementBase() {
  static readonly tagName = 'server-monitor';
  static readonly observedAttributes = ['src', 'transport', 'theme', 'locale', 'columns', 'interval', 'title'];

  /** Fired when a dashboard affordance is activated (`detail: { action, payload }`). */
  static readonly ACTION_EVENT = 'widget-action';
  /** Fired on every snapshot (`detail: WidgetSnapshot`). */
  static readonly SNAPSHOT_EVENT = 'widget-snapshot';
  /** Fired when the data source fails (`detail: Error`). */
  static readonly ERROR_EVENT = 'widget-error';

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private container: HTMLDivElement | null = null;
  private liveRegion: HTMLDivElement | null = null;
  private description: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private frame = 0;
  private store: WidgetStore | null = null;
  private connector: WidgetConnector | null = null;
  private staticTransport: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: Array<() => void> = [];

  private config = resolveConfig();
  private theme: ThemeTokens = resolveTheme('dark');
  private translator: Translator = createTranslator('en');
  private layout: LayoutResult | null = null;
  private vm: ViewModel | null = null;
  private regions: HitRegion[] = [];
  private hovered: HitRegion | null = null;
  private pointer = { x: 0, y: 0 };
  private manualSnapshot: WidgetSnapshot | null = null;
  private started = false;
  private keyboardIndex = -1;

  /** Current resolved configuration (read-only copy). */
  get configValue(): ServerMonitorConfig {
    return { ...this.config };
  }

  get hostStatus(): StatusLevel {
    return this.vm?.status ?? 'unknown';
  }

  get snapshot(): WidgetSnapshot | null {
    return this.store?.snapshot ?? null;
  }

  connectedCallback(): void {
    if (this.started) return;
    this.started = true;
    this.upgradeConfigFromAttributes();
    this.buildDom();
    this.applyTheme();
    this.store = new WidgetStore({
      historySize: this.config.historySize,
      ...(this.config.thresholds ? { thresholds: this.config.thresholds } : {}),
    });

    this.unsubscribers.push(
      this.store.on('update', () => this.scheduleRender()),
      this.store.on('alert', (payload) => {
        this.dispatchEvent(new CustomEvent('widget-alert', { detail: payload }));
        this.announce(`${payload.metric} ${payload.to}`);
      }),
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
    if (this.store) this.store.setThresholds(this.config.thresholds ?? {});
    this.startSource();
    this.scheduleRender();
  }

  /** Apply a full configuration (or patch). Restarts the source when it changes. */
  setConfig(config: ServerMonitorConfig): void {
    const sourceChanged = config.source !== undefined;
    this.config = resolveConfig({ ...this.config, ...config });
    this.translator = createTranslator(this.config.locale, this.config.messages);
    this.applyTheme();
    this.store?.setThresholds(this.config.thresholds ?? {});
    if (sourceChanged) this.startSource();
    this.scheduleRender();
  }

  /** Push a snapshot from a host bridge (native, server rendered, tests). */
  setSnapshot(snapshot: WidgetSnapshot): void {
    this.manualSnapshot = snapshot;
    if (this.store) this.store.update(snapshot);
  }

  /** Force a poll / re-subscribe on the active transport. */
  refresh(): void {
    this.connector?.refresh();
  }

  /** Detach the data source but keep the widget mounted. */
  stop(): void {
    this.connector?.stop();
    this.connector = null;
    if (this.staticTransport) {
      clearInterval(this.staticTransport);
      this.staticTransport = null;
    }
  }

  /** Re-attach the data source after `stop()`. */
  start(): void {
    this.startSource();
  }

  // ── DOM ────────────────────────────────────────────────────────────────────

  private buildDom(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = `
      :host { display: block; position: relative; contain: strict; }
      :host([hidden]) { display: none; }
      .frame { position: absolute; inset: 0; }
      canvas { display: block; width: 100%; height: 100%; touch-action: manipulation; }
      .a11y { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
        overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
      .focus-ring { position: absolute; inset: 0; pointer-events: none;
        box-shadow: inset 0 0 0 2px transparent; transition: box-shadow .15s ease; }
      :host([data-focused='true']) .focus-ring { box-shadow: inset 0 0 0 2px rgba(47,123,246,.75); }
    `;

    this.container = document.createElement('div');
    this.container.className = 'frame';

    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.tabIndex = 0;
    this.canvas.style.outline = 'none';

    const focusRing = document.createElement('div');
    focusRing.className = 'focus-ring';

    this.description = document.createElement('div');
    this.description.className = 'a11y';
    this.description.setAttribute('aria-live', 'polite');

    this.liveRegion = document.createElement('div');
    this.liveRegion.className = 'a11y';
    this.liveRegion.setAttribute('role', 'status');
    this.liveRegion.setAttribute('aria-live', 'polite');

    this.container.append(this.canvas, focusRing, this.description, this.liveRegion);
    root.append(style, this.container);

    this.ctx = this.canvas.getContext('2d');
    this.bindInteractions();
  }

  private bindInteractions(): void {
    const canvas = this.canvas;
    if (!canvas) return;

    canvas.addEventListener('pointermove', (event) => {
      const point = this.toCanvasSpace(event);
      this.pointer = point;
      const region = findRegion(this.regions, point.x, point.y);
      if (region?.id !== this.hovered?.id) {
        this.hovered = region ?? null;
        canvas.style.cursor = region?.action ? 'pointer' : region ? 'help' : 'default';
        this.scheduleRender();
      } else if (region && this.vm) {
        this.scheduleRender();
      }
    });

    canvas.addEventListener('pointerleave', () => {
      this.hovered = null;
      canvas.style.cursor = 'default';
      this.scheduleRender();
    });

    canvas.addEventListener('pointerdown', (event) => {
      const point = this.toCanvasSpace(event);
      const region = findRegion(this.regions, point.x, point.y);
      if (region?.action) this.emitAction(region);
    });

    canvas.addEventListener('focus', () => this.setAttribute('data-focused', 'true'));
    canvas.addEventListener('blur', () => {
      this.removeAttribute('data-focused');
      this.keyboardIndex = -1;
      this.hovered = null;
      this.scheduleRender();
    });

    canvas.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') return;
      const actionable = this.regions.filter((region) => Boolean(region.tooltip));
      if (actionable.length === 0) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        this.keyboardIndex = (this.keyboardIndex + 1) % actionable.length;
        this.hovered = actionable[this.keyboardIndex] ?? null;
        this.announce(this.hovered?.tooltip ?? '');
        this.scheduleRender();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.keyboardIndex = (this.keyboardIndex - 1 + actionable.length) % actionable.length;
        this.hovered = actionable[this.keyboardIndex] ?? null;
        this.announce(this.hovered?.tooltip ?? '');
        this.scheduleRender();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (this.hovered) this.emitAction(this.hovered);
      } else if (event.key === 'Escape') {
        this.hovered = null;
        this.scheduleRender();
      }
    });

    const resize = () => this.observeResize();
    window.addEventListener('resize', resize);
    this.unsubscribers.push(() => window.removeEventListener('resize', resize));
  }

  private toCanvasSpace(event: PointerEvent | MouseEvent): { x: number; y: number } {
    const rect = this.canvas?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private emitAction(region: HitRegion): void {
    this.config.onAction?.(region.action ?? region.id, region.payload);
    this.dispatchEvent(
      new CustomEvent(ServerMonitorElement.ACTION_EVENT, {
        detail: { action: region.action ?? region.id, payload: region.payload },
        bubbles: true,
        composed: true,
      }),
    );
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

  private announce(message: string): void {
    if (!this.liveRegion || !message) return;
    this.liveRegion.textContent = message;
  }


  // ── Data source ────────────────────────────────────────────────────────────

  private startSource(): void {
    this.stop();
    if (!this.store) return;

    const source = this.resolveSource();
    if (isStaticSource(source)) {
      const getter = typeof source === 'function' ? source : () => this.manualSnapshot ?? staticSnapshot(source);
      const push = () => {
        const snapshot = getter();
        if (snapshot) this.store?.update(snapshot);
      };
      push();
      this.staticTransport = setInterval(push, 2000);
      return;
    }

    const transport = createTransport(source, () => this.manualSnapshot);
    if (!transport) return;
    this.connector = new WidgetConnector(transport, this.store);
    this.connector.on('snapshot', (snapshot) => {
      this.dispatchEvent(new CustomEvent(ServerMonitorElement.SNAPSHOT_EVENT, { detail: snapshot }));
    });
    this.connector.on('status', () => this.scheduleRender());
    this.connector.on('error', (error) => {
      this.config.onError?.(error);
      this.dispatchEvent(new CustomEvent(ServerMonitorElement.ERROR_EVENT, { detail: error }));
    });
    void this.connector.start().catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.config.onError?.(err);
      this.dispatchEvent(new CustomEvent(ServerMonitorElement.ERROR_EVENT, { detail: err }));
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
      if (transport === 'http') {
        return { transport: 'http', url: src, intervalMs: this.intervalFromAttribute() };
      }
      return src;
    }
    return this.config.source ?? null;
  }

  private intervalFromAttribute(): number {
    const raw = Number.parseInt(this.getAttribute('interval') ?? '', 10);
    return Number.isFinite(raw) && raw >= 250 ? raw : 2000;
  }

  private upgradeConfigFromAttributes(): void {
    const patch: ServerMonitorConfig = {};
    const theme = this.getAttribute('theme');
    if (theme === 'dark' || theme === 'light') patch.theme = theme as ThemeName;
    const locale = this.getAttribute('locale');
    if (locale) patch.locale = locale;
    const columns = this.getAttribute('columns');
    if (columns === '1' || columns === '2') patch.columns = Number(columns) as 1 | 2;
    const title = this.getAttribute('title');
    if (title) patch.title = title;
    this.config = resolveConfig({ ...this.config, ...patch });
    this.translator = createTranslator(this.config.locale, this.config.messages);
  }

  private applyTheme(): void {
    this.theme = resolveTheme(this.config.theme, this.config.themeOverride);
  }


  // ── Rendering ──────────────────────────────────────────────────────────────

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

    // Prefer the host element's own box (works even before the inner frame has
    // been laid out), then the frame, then a sane default for headless hosts.
    const cssWidth = Math.max(1, this.clientWidth || container.clientWidth || 760);
    const cssHeight = Math.max(1, this.clientHeight || container.clientHeight || 560);

    this.layout = computeLayout({
      width: cssWidth,
      height: cssHeight,
      ...(this.config.columns ? { columns: this.config.columns } : {}),
      breakpoint: this.config.breakpoint,
      ...(this.config.padding != null ? { padding: this.config.padding } : {}),
      ...(this.config.gap != null ? { gap: this.config.gap } : {}),
      hidden: hiddenSectionIds(this.config.sections),
    });

    this.vm = buildViewModel({
      snapshot: this.store?.snapshot ?? null,
      history: this.store?.historySnapshot() ?? EMPTY_HISTORY,
      theme: this.theme,
      thresholds: mergeThresholds(this.config.thresholds),
      t: this.translator,
      connectionState: this.connector?.status.state ?? (this.staticTransport ? 'live' : 'idle'),
      hiddenSections: this.config.sections,
    });
    this.updateAccessibility();

    if (!ctx) {
      // Headless host (native bridge, tests without a 2D context): layout and
      // view model are still published for the host to render natively.
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
    const result = renderDashboard(ctx, {
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

  /** Interactive regions of the last frame (documented for host tooling/tests). */
  get hitRegions(): readonly HitRegion[] {
    return this.regions;
  }

  /** Last computed layout (documented for host tooling/tests). */
  get currentLayout(): LayoutResult | null {
    return this.layout;
  }

  /** Last computed view model (documented for host tooling/tests). */
  get viewModel(): ViewModel | null {
    return this.vm;
  }

  private updateAccessibility(): void {
    if (!this.vm || !this.canvas || !this.description) return;
    const vm = this.vm;
    const summary = [
      `${this.config.title ?? vm.host.name}: ${vm.connection.label}`,
      `CPU ${vm.gauges[0]?.valueLabel ?? '—'}`,
      `Memory ${vm.gauges[1]?.valueLabel ?? '—'}`,
      `Disk ${vm.gauges[2]?.valueLabel ?? '—'}`,
      `health ${vm.score.health} (${vm.score.grade})`,
      `${vm.alertCount} alerts`,
    ].join(' · ');

    this.canvas.setAttribute('aria-label', `${this.config.title ?? vm.host.name} server resource monitor`);
    this.canvas.setAttribute('aria-description', summary);
    if (this.description.textContent !== summary) this.description.textContent = summary;
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

const EMPTY_HISTORY: MetricHistory = {
  cpu: [],
  memory: [],
  disk: [],
  networkRx: [],
  networkTx: [],
  load: [],
};

function hiddenSectionIds(sections: ServerMonitorConfig['sections']): SectionId[] {
  return Object.entries(sections ?? {})
    .filter(([, enabled]) => enabled === false)
    .map(([id]) => id as SectionId);
}

/** Keeps a static snapshot's timestamp fresh so the "updated Ns" label ticks. */
function staticSnapshot(source: WidgetSnapshot | null): WidgetSnapshot | null {
  if (!source) return null;
  return { ...source, timestamp: source.timestamp || Date.now() };
}
/** Convenience helper for hosts that just want a synthetic snapshot. */
export function mockSnapshot(): WidgetSnapshot {
  return createMockSnapshot({ elapsedSeconds: Date.now() / 1000 });
}

