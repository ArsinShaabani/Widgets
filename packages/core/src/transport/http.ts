import type { WidgetSnapshot } from '../types';
import { BaseTransport } from './base';
import { nextBackoff, type BackoffOptions, type SnapshotNormalizer } from './types';

export interface HttpTransportOptions<T = WidgetSnapshot> {
  /** Endpoint returning JSON (canonical snapshot or flat metrics). */
  url: string;
  /** Poll interval in ms (default 2000). */
  intervalMs?: number;
  /** Extra headers (e.g. auth). */
  headers?: Record<string, string>;
  /** HTTP method, default GET. */
  method?: 'GET' | 'POST';
  /** Optional body for POST requests. */
  body?: unknown;
  /** Abort a request after this many ms (default 8000). */
  timeoutMs?: number;
  /** Credentials mode, default 'same-origin'. Use 'include' for cookie auth. */
  credentials?: RequestCredentials;
  /** Injectable fetch (tests, polyfills). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Pause polling while the document is hidden (default true in browsers). */
  pauseWhenHidden?: boolean;
  backoff?: BackoffOptions;
  /** Widget specific payload mapper (defaults to the server-metrics normaliser). */
  normalize?: SnapshotNormalizer<T>;
}

/**
 * Request/response data source.
 *
 * Polls an HTTP endpoint on a fixed cadence and falls back to exponential
 * backoff when the endpoint misbehaves, so a widget never hammers a dead server.
 */
export class HttpTransport<T = WidgetSnapshot> extends BaseTransport<T> {
  readonly kind = 'http';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private attempt = 0;
  private readonly options: Required<
    Pick<HttpTransportOptions, 'intervalMs' | 'timeoutMs' | 'credentials' | 'pauseWhenHidden' | 'method'>
  > &
    HttpTransportOptions<T>;
  private readonly fetchImpl: typeof fetch;
  private visibilityHandler: (() => void) | null = null;

  constructor(options: HttpTransportOptions<T>) {
    super({ backoff: options.backoff, normalize: options.normalize });
    this.options = {
      intervalMs: 2000,
      timeoutMs: 8000,
      credentials: 'same-origin',
      pauseWhenHidden: true,
      method: 'GET',
      ...options,
    };
    const globalFetch = (globalThis as { fetch?: typeof fetch }).fetch;
    const impl = options.fetchImpl ?? globalFetch;
    if (!impl) throw new Error('[widgets] HttpTransport requires fetch; pass fetchImpl on this runtime');
    // Bind to the global scope: `window.fetch` throws "Illegal invocation" when it
    // is called with any other receiver, and `this.fetchImpl(...)` would hand it
    // the transport instance.
    this.fetchImpl = impl.bind(globalThis) as typeof fetch;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.patchStatus({ state: 'connecting' });
    if (this.options.pauseWhenHidden && typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        if (document.visibilityState === 'visible') this.schedule(0);
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
    await this.tick();
  }

  override stop(): void {
    super.stop();
    this.clearTimer();
    this.controller?.abort();
    this.controller = null;
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  /** Force an immediate poll (used by the widget's retry/refresh affordance). */
  refresh(): void {
    if (this.stopped) return;
    this.clearTimer();
    void this.tick();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    if (this.options.pauseWhenHidden && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.schedule(this.options.intervalMs);
      return;
    }

    this.controller = new AbortController();
    const timeout = setTimeout(() => this.controller?.abort(), this.options.timeoutMs);
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(this.options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...this.options.headers,
    };

    try {
      const response = await this.fetchImpl(this.options.url, {
        method: this.options.method,
        headers,
        credentials: this.options.credentials,
        signal: this.controller.signal,
        ...(this.options.body !== undefined
          ? { body: typeof this.options.body === 'string' ? this.options.body : JSON.stringify(this.options.body) }
          : {}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      const payload = (await response.json()) as unknown;
      const snapshot = this.ingest(payload);
      this.attempt = 0;
      if (!snapshot) throw new Error('payload did not contain any recognisable metrics');
      this.schedule(this.options.intervalMs);
    } catch (error) {
      // A manual stop aborts the in-flight request: not an error.
      if (this.stopped) return;
      this.attempt += 1;
      this.patchStatus({ state: 'reconnecting', attempts: this.attempt, error: toErr(error) });
      this.events.emit('error', toErr(error));
      this.schedule(nextBackoff(this.attempt, this.backoff));
    } finally {
      clearTimeout(timeout);
    }
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.clearTimer();
    this.timer = setTimeout(() => void this.tick(), delay);
  }
}

function toErr(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
