import { BaseTransport } from './base';
import { nextBackoff, type BackoffOptions } from './types';

/** Minimal EventSource surface (DOM `EventSource`, `eventsource` package, ...). */
export interface EventSourceLike {
  close(): void;
  addEventListener?(type: string, listener: (event: { data?: string }) => void): void;
  on?(type: string, listener: (event: { data?: string }) => void): void;
}

export interface EventSourceFactory {
  new (url: string, init?: { withCredentials?: boolean }): EventSourceLike;
}

export interface SseTransportOptions {
  url: string;
  /** Named SSE event carrying a snapshot (default `message`). */
  eventName?: string;
  withCredentials?: boolean;
  /** BE implementation (browsers: global `EventSource`; Node: `eventsource`). */
  eventSourceFactory?: EventSourceFactory;
  backoff?: BackoffOptions;
}

/**
 * Server-Sent Events data source.
 *
 * Ideal for read-only metric streams: a single long-lived HTTP response that the
 * backend can push on its own cadence.
 */
export class SseTransport extends BaseTransport {
  readonly kind = 'sse';
  private source: EventSourceLike | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly options: SseTransportOptions;
  private readonly factory: EventSourceFactory;

  constructor(options: SseTransportOptions) {
    super({ backoff: options.backoff });
    this.options = { eventName: 'message', ...options };
    const impl =
      options.eventSourceFactory ?? (globalThis as { EventSource?: EventSourceFactory }).EventSource;
    if (!impl) throw new Error('[widgets] SseTransport requires an eventSourceFactory on this runtime');
    this.factory = impl;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.open();
  }

  override stop(): void {
    super.stop();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.source?.close();
    this.source = null;
  }

  private open(): void {
    if (this.stopped) return;
    this.patchStatus({ state: this.attempt === 0 ? 'connecting' : 'reconnecting', attempts: this.attempt });
    let source: EventSourceLike;
    try {
      source = new this.factory(this.options.url, { withCredentials: this.options.withCredentials });
    } catch (error) {
      this.fail(error);
      this.scheduleReconnect();
      return;
    }
    this.source = source;

    const handler = (event: { data?: string }) => {
      if (event.data == null) return;
      try {
        this.attempt = 0;
        this.ingest(JSON.parse(event.data));
      } catch (error) {
        this.events.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
    };

    if (typeof source.addEventListener === 'function') {
      source.addEventListener(this.options.eventName ?? 'message', handler);
      source.addEventListener('error', () => this.scheduleReconnect());
    } else if (typeof source.on === 'function') {
      source.on(this.options.eventName ?? 'message', handler);
      source.on('error', () => this.scheduleReconnect());
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.attempt += 1;
    this.patchStatus({ state: 'reconnecting', attempts: this.attempt });
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.source?.close();
      this.source = null;
      this.open();
    }, nextBackoff(this.attempt, this.backoff));
  }
}
