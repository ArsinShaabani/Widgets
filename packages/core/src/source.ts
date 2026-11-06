import { BaseTransport } from './transport/base';
import { HttpTransport } from './transport/http';
import { SseTransport } from './transport/sse';
import { WebSocketTransport } from './transport/websocket';
import type { DataTransport, SnapshotNormalizer } from './transport/types';

/**
 * Source resolution shared by every widget.
 *
 * A widget declares *what* it needs: a normaliser, a synthetic factory and a
 * default cadence. This module turns the many shapes a host may pass in into one
 * `DataTransport`.
 */

/** Descriptor form for the built-in synthetic source (widget specific keys allowed). */
export interface MockSourceDescriptor {
  transport: 'mock';
  intervalMs?: number;
  seed?: number;
  [key: string]: unknown;
}

/** Network source descriptor. */
export interface NetworkSourceDescriptor {
  transport: 'websocket' | 'http' | 'sse';
  url?: string;
  /** Poll interval in ms. */
  intervalMs?: number;
  headers?: Record<string, string>;
  token?: string;
  withCredentials?: boolean;
  /** Extra subscribe payload for the WebSocket transport. */
  subscribe?: Record<string, unknown>;
}

/**
 * Anything a widget can be pointed at:
 *
 *  - a ready `DataTransport`
 *  - a URL string (auto-detected: `ws(s)://` → WebSocket, `…/events` → SSE, else HTTP)
 *  - an object describing the source and its options
 *  - a static snapshot or a getter (native bridge, server-rendered page)
 *  - `null` → the widget's in-process mock stream
 */
export type WidgetSource<T> =
  | DataTransport<T>
  | string
  | MockSourceDescriptor
  | NetworkSourceDescriptor
  | T
  | (() => T | null)
  | null;

export interface SourceOptions<T> {
  /** Widget specific payload mapper handed to every transport. */
  normalize: SnapshotNormalizer<T>;
  /** Default poll interval for descriptor sources (default 2000 ms). */
  intervalMs?: number;
  /** Builds the synthetic transport for `null` / `{ transport: 'mock' }`. */
  createMock: (descriptor: MockSourceDescriptor | null) => DataTransport<T>;
}

const DEFAULT_INTERVAL = 2000;

/** True for the built-in synthetic source (`null` means "no explicit source"). */
export function isMockSource<T>(source: WidgetSource<T>): boolean {
  if (source == null) return true;
  if (typeof source !== 'object') return false;
  if ('transport' in source) return (source as { transport?: unknown }).transport === 'mock';
  return false;
}

/** True for a fully fledged transport implementation. */
export function isTransport<T>(value: unknown): value is DataTransport<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as DataTransport<T>).start === 'function' &&
    typeof (value as DataTransport<T>).subscribe === 'function'
  );
}

/** True when the host hands us data directly (snapshot object or getter). */
export function isStaticSource<T>(source: WidgetSource<T>): source is T | (() => T | null) {
  if (source == null) return false;
  if (typeof source === 'function') return true;
  if (typeof source !== 'object') return false;
  return !('transport' in source) && !isTransport<T>(source);
}

/**
 * Builds a transport for the configured source.
 *
 * Returns `null` only for descriptors that cannot be constructed (a network
 * descriptor without a URL); static sources are served by `StaticPollTransport`.
 */
export function createTransport<T>(source: WidgetSource<T>, options: SourceOptions<T>): DataTransport<T> | null {
  const interval = options.intervalMs ?? DEFAULT_INTERVAL;

  if (source == null) return options.createMock(null);
  if (typeof source === 'string') return fromUrl(source, options);
  if (typeof source === 'function') {
    return new StaticPollTransport<T>(source as unknown as () => T | null, interval, options.normalize);
  }
  if (isTransport<T>(source)) return source;

  if (typeof source === 'object' && 'transport' in source) {
    const descriptor = source as MockSourceDescriptor | NetworkSourceDescriptor;
    switch (descriptor.transport) {
      case 'mock':
        return options.createMock(descriptor as MockSourceDescriptor);
      case 'websocket':
        return new WebSocketTransport<T>({
          url: requireUrl(descriptor.url),
          token: descriptor.token,
          subscribe: descriptor.subscribe,
          normalize: options.normalize,
        });
      case 'sse':
        return new SseTransport<T>({
          url: requireUrl(descriptor.url),
          withCredentials: descriptor.withCredentials,
          normalize: options.normalize,
        });
      default:
        return new HttpTransport<T>({
          url: requireUrl(descriptor.url),
          intervalMs: descriptor.intervalMs ?? interval,
          headers: descriptor.headers,
          credentials: descriptor.withCredentials ? 'include' : undefined,
          normalize: options.normalize,
        });
    }
  }

  // A plain snapshot object: serve it through a static poller so the store,
  // history and stats take the exact same code path as a live feed.
  return new StaticPollTransport<T>(() => source as T, interval, options.normalize);
}

function fromUrl<T>(url: string, options: SourceOptions<T>): DataTransport<T> {
  if (/^wss?:\/\//i.test(url)) {
    return new WebSocketTransport<T>({ url, normalize: options.normalize });
  }
  if (/\.sse($|\?)/i.test(url) || /\/events($|\?)/i.test(url)) {
    return new SseTransport<T>({ url, normalize: options.normalize });
  }
  return new HttpTransport<T>({
    url,
    intervalMs: options.intervalMs ?? DEFAULT_INTERVAL,
    normalize: options.normalize,
  });
}

function requireUrl(url: string | undefined): string {
  if (!url) throw new Error('[widgets] source.url is required for network transports');
  return url;
}

/**
 * Re-emits whatever the host hands us through a getter.
 * Used for native bridges, server-rendered snapshots and tests.
 */
export class StaticPollTransport<T> extends BaseTransport<T> {
  readonly kind = 'static';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly snapshot: () => T | null,
    private readonly intervalMs = DEFAULT_INTERVAL,
    normalize?: SnapshotNormalizer<T>,
  ) {
    super({ ...(normalize ? { normalize } : {}) });
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

