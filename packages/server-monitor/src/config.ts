import {
  BaseTransport,
  HttpTransport,
  MockTransport,
  SseTransport,
  WebSocketTransport,
  type DataTransport,
  type Messages,
  type ThresholdConfig,
  type ThemeName,
  type ThemeOverride,
  type ThemeTokens,
  type WidgetSnapshot,
} from '@widgets/core';
import type { SectionId } from './layout';

/**
 * Anything a widget can be pointed at.
 *
 *  - a ready `DataTransport` (full control)
 *  - a URL string (auto-detected: `ws(s)://` → WebSocket, `.../events` → SSE,
 *    otherwise HTTP polling)
 *  - an object describing the source and its options
 *  - a static snapshot or a getter (hosts that already hold the data, e.g. a
 *    native bridge or a server-rendered page)
 *  - `null` → deterministic mock stream (great for design work and tests)
 */
export type WidgetSource =
  | DataTransport
  | string
  | {
      transport: 'websocket' | 'http' | 'sse' | 'mock';
      url?: string;
      /** Poll interval in ms (http) or emit cadence (mock). */
      intervalMs?: number;
      headers?: Record<string, string>;
      token?: string;
      withCredentials?: boolean;
      /** Extra subscribe payload for the WebSocket transport. */
      subscribe?: Record<string, unknown>;
      /** Mock-only knobs (handy for demos and visual tests). */
      cpuBaseline?: number;
      cores?: number;
      hostname?: string;
      seed?: number;
    }
  | WidgetSnapshot
  | (() => WidgetSnapshot | null)
  | null;

export interface ServerMonitorConfig {
  /** Data source; defaults to the built-in mock stream. */
  source?: WidgetSource;
  theme?: ThemeName | ThemeTokens;
  themeOverride?: ThemeOverride;
  thresholds?: Partial<ThresholdConfig>;
  locale?: string;
  messages?: Messages;
  /** Force a column count; default is responsive (2 columns at ≥ breakpoint). */
  columns?: 1 | 2;
  /** Column collapse breakpoint in CSS px (default 720). */
  breakpoint?: number;
  padding?: number;
  gap?: number;
  /** Hide individual dashboard sections. */
  sections?: Partial<Record<SectionId, boolean>>;
  /** Points kept per history series (default 120). */
  historySize?: number;
  /** Accessible title; defaults to the host name. */
  title?: string;
  /** Show hover tooltips on charts (default true). */
  tooltips?: boolean;
  /** Click handler for the quick-action row and status badges. */
  onAction?: (action: string, payload?: unknown) => void;
  /** Connection problems are reported to the host, never swallowed silently. */
  onError?: (error: Error) => void;
}

export interface ResolvedConfig {
  source: WidgetSource;
  theme: ThemeName | ThemeTokens;
  themeOverride: ThemeOverride;
  thresholds: Partial<ThresholdConfig> | undefined;
  locale: string;
  messages: Messages | undefined;
  columns: 1 | 2 | undefined;
  breakpoint: number;
  padding: number | undefined;
  gap: number | undefined;
  sections: Partial<Record<SectionId, boolean>>;
  historySize: number;
  title: string | undefined;
  tooltips: boolean;
  onAction: ((action: string, payload?: unknown) => void) | undefined;
  onError: ((error: Error) => void) | undefined;
}

export const defaultConfig: ResolvedConfig = {
  source: null,
  theme: 'dark',
  themeOverride: {},
  thresholds: undefined,
  locale: 'en',
  messages: undefined,
  columns: undefined,
  breakpoint: 720,
  padding: undefined,
  gap: undefined,
  sections: {},
  historySize: 120,
  title: undefined,
  tooltips: true,
  onAction: undefined,
  onError: undefined,
};

/** Fills in defaults for a partial config. */
export function resolveConfig(config: ServerMonitorConfig = {}): ResolvedConfig {
  return { ...defaultConfig, ...config };
}

/**
 * True for the built-in synthetic source.
 *
 * `null`/`undefined` means "no explicit source": the widget falls back to the
 * in-process mock stream, which is what the demo and the docs rely on.
 */
export function isMockSource(source: WidgetSource): boolean {
  if (source == null) return true;
  if (typeof source !== 'object') return false;
  if ('transport' in source) return source.transport === 'mock';
  return false;
}

/** True when the widget can feed the store directly (no transport needed). */
export function isStaticSource(
  source: WidgetSource,
): source is WidgetSnapshot | (() => WidgetSnapshot | null) {
  if (source == null) return false;
  if (typeof source === 'function') return true;
  if (typeof source !== 'object') return false;
  return !('transport' in source) && !isTransport(source);
}

/** True for a fully fledged transport implementation. */
export function isTransport(value: unknown): value is DataTransport {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as DataTransport).start === 'function' &&
    typeof (value as DataTransport).subscribe === 'function'
  );
}

/**
 * Builds a transport for the configured source.
 *
 * Returns `null` for static sources (a snapshot object or a getter): the element
 * then feeds the store directly instead of polling the network.
 */
export function createTransport(source: WidgetSource, snapshot: () => WidgetSnapshot | null): DataTransport | null {
  if (source == null) return new MockTransport({ intervalMs: 1500 });
  if (typeof source === 'string') return fromUrl(source);
  if (typeof source === 'function') return new StaticPollTransport(snapshot);
  if (isTransport(source)) return source;
  if (typeof source === 'object' && 'transport' in source) {
    if (source.transport === 'mock') {
      return new MockTransport({
        intervalMs: source.intervalMs ?? 1500,
        ...(source.cpuBaseline != null ? { cpuBaseline: source.cpuBaseline } : {}),
        ...(source.cores != null ? { cores: source.cores } : {}),
        ...(source.hostname != null ? { hostname: source.hostname } : {}),
        ...(source.seed != null ? { seed: source.seed } : {}),
      });
    }
    if (source.transport === 'websocket') {
      return new WebSocketTransport({
        url: requireUrl(source.url),
        token: source.token,
        subscribe: source.subscribe,
      });
    }
    if (source.transport === 'sse') {
      return new SseTransport({ url: requireUrl(source.url), withCredentials: source.withCredentials });
    }
    return new HttpTransport({
      url: requireUrl(source.url),
      intervalMs: source.intervalMs ?? 2000,
      headers: source.headers,
      credentials: source.withCredentials ? 'include' : undefined,
    });
  }
  // A plain snapshot: push it once through a static poller so the store, history
  // and alerts take the exact same code path as a live feed.
  return new StaticPollTransport(snapshot);
}

function fromUrl(url: string): DataTransport {
  if (/^wss?:\/\//i.test(url)) return new WebSocketTransport({ url });
  if (/\.sse($|\?)/i.test(url) || /\/events($|\?)/i.test(url)) return new SseTransport({ url });
  return new HttpTransport({ url });
}

function requireUrl(url: string | undefined): string {
  if (!url) throw new Error('[widgets] source.url is required for network transports');
  return url;
}

/**
 * Re-emits whatever the host hands us through a getter. Used for native bridges,
 * server-rendered snapshots and tests, so the widget pipeline stays identical.
 */
export class StaticPollTransport extends BaseTransport {
  readonly kind = 'static';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly snapshot: () => WidgetSnapshot | null,
    private readonly intervalMs = 2000,
  ) {
    super();
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.patchStatus({ state: 'connecting' });
    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  override stop(): void {
    super.stop();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  refresh(): void {
    this.poll();
  }

  private poll(): void {
    try {
      const snapshot = this.snapshot();
      if (snapshot) this.ingest(snapshot);
    } catch (error) {
      this.fail(error);
    }
  }
}

