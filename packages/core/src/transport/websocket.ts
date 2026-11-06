import type { WidgetSnapshot } from '../types';
import { BaseTransport } from './base';
import { nextBackoff, type BackoffOptions, type SnapshotNormalizer } from './types';

/** Minimal surface the transport needs — matches DOM `WebSocket` and `ws`. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener?(type: string, listener: (event: unknown) => void): void;
  removeEventListener?(type: string, listener: (event: unknown) => void): void;
  on?(type: string, listener: (...args: unknown[]) => void): void;
  off?(type: string, listener: (...args: unknown[]) => void): void;
}

/** Socket constructor — matches the DOM `WebSocket` and the `ws` package. */
export interface SocketFactory {
  new (url: string, protocols?: string | string[]): SocketLike;
}

export interface WebSocketTransportOptions<T = WidgetSnapshot> {
  url: string;
  /** Subscribe behaviour: `'widgets'` sends a subscribe frame, `'none'` just listens. */
  protocol?: 'widgets' | 'none';
  /** Extra fields merged into the subscribe frame. */
  subscribe?: Record<string, unknown>;
  /** Auth token sent with the subscribe frame. */
  token?: string;
  /** Heartbeat ping interval in ms (default 20000; 0 disables). */
  heartbeatMs?: number;
  /** Socket implementation (browsers use the global, Node should pass `ws`). */
  socketFactory?: SocketFactory;
  backoff?: BackoffOptions;
  /** Widget specific payload mapper (defaults to the server-metrics normaliser). */
  normalize?: SnapshotNormalizer<T>;
}

const OPEN = 1;

/**
 * Streaming data source over WebSocket.
 *
 * Reconnects with exponential backoff + jitter, re-sends the subscribe frame on
 * every (re)connect and optionally keeps the link warm with heartbeats.
 */
export class WebSocketTransport<T = WidgetSnapshot> extends BaseTransport<T> {
  readonly kind = 'websocket';
  private socket: SocketLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private attempt = 0;
  private readonly options: WebSocketTransportOptions<T>;
  private readonly factory: SocketFactory;

  constructor(options: WebSocketTransportOptions<T>) {
    super({ backoff: options.backoff, normalize: options.normalize });
    this.options = { protocol: 'widgets', heartbeatMs: 20_000, ...options };
    const impl = options.socketFactory ?? (globalThis as unknown as { WebSocket?: SocketFactory }).WebSocket;
    if (!impl) throw new Error('[widgets] WebSocketTransport requires a socketFactory on this runtime');
    this.factory = impl;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.open();
  }

  override stop(): void {
    super.stop();
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close(1000, 'widget stopped');
      } catch {
        /* the socket is already gone */
      }
    }
  }

  /** Re-send the subscribe frame (used by the widget refresh affordance). */
  refresh(): void {
    if (this.socket) this.sendSubscribe();
  }

  private open(): void {
    if (this.stopped) return;
    this.patchStatus({ state: this.attempt === 0 ? 'connecting' : 'reconnecting', attempts: this.attempt });

    let socket: SocketLike;
    try {
      socket = new this.factory(this.options.url);
    } catch (error) {
      this.handleFailure(error);
      return;
    }
    this.socket = socket;

    this.bind(socket, 'open', () => {
      this.attempt = 0;
      this.patchStatus({ state: 'live', error: null, attempts: 0 });
      this.sendSubscribe();
      this.startHeartbeat();
    });

    this.bind(socket, 'message', (...args: unknown[]) => this.handleMessage(args));

    this.bind(socket, 'close', () => {
      this.stopHeartbeat();
      if (this.stopped) return;
      this.handleFailure(new Error('socket closed'));
    });

    this.bind(socket, 'error', (...args: unknown[]) => {
      const error = args[0] instanceof Error ? args[0] : new Error('socket error');
      this.events.emit('error', error);
    });
  }

  private handleMessage(args: unknown[]): void {
    const data = extractData(args);
    if (data == null) return;
    if (typeof data === 'string' && (data === 'pong' || data.startsWith('pong'))) return;
    try {
      const payload = typeof data === 'string' ? JSON.parse(data) : data;
      this.ingest(payload);
    } catch (error) {
      this.events.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleFailure(error: unknown): void {
    if (this.stopped) return;
    this.attempt += 1;
    const err = error instanceof Error ? error : new Error(String(error));
    this.patchStatus({ state: 'reconnecting', attempts: this.attempt, error: err });
    this.events.emit('error', err);
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => this.open(), nextBackoff(this.attempt, this.backoff));
  }

  private sendSubscribe(): void {
    if (!this.socket || this.socket.readyState !== OPEN) return;
    if (this.options.protocol === 'none') return;
    const frame: Record<string, unknown> = {
      type: 'subscribe',
      stream: 'server-metrics',
      subscribe: this.options.subscribe ?? {},
    };
    if (this.options.token) frame.token = this.options.token;
    try {
      this.socket.send(JSON.stringify(frame));
    } catch (error) {
      this.events.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const heartbeatMs = this.options.heartbeatMs ?? 0;
    if (!heartbeatMs) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState !== OPEN) return;
      try {
        this.socket.send(JSON.stringify({ type: 'ping', t: Date.now() }));
      } catch {
        /* the close handler takes over */
      }
    }, heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearReconnect();
    this.stopHeartbeat();
  }

  /** Bridges DOM-style `addEventListener` and Node-style `on` socket APIs. */
  private bind(socket: SocketLike, type: string, handler: (...args: unknown[]) => void): void {
    if (typeof socket.addEventListener === 'function') {
      socket.addEventListener(type, handler);
      return;
    }
    if (typeof socket.on === 'function') {
      socket.on(type, handler);
      return;
    }
    // Fallback for `onopen`-style implementations.
    (socket as unknown as Record<string, unknown>)[`on${type}`] = handler;
  }
}

/** Extracts the message body from either DOM (`MessageEvent`) or `ws` signatures. */
function extractData(args: unknown[]): unknown {
  if (args.length === 0) return null;
  const first = args[0];
  if (typeof first === 'object' && first !== null && 'data' in (first as Record<string, unknown>)) {
    return decode((first as MessageEvent).data);
  }
  return decode(first);
}

/**
 * Converts raw frame payloads into a value `ingest` understands.
 *
 * Node's `ws` hands over a `Buffer` (a `Uint8Array` subclass); browsers hand over
 * a `string`, `Blob` or `ArrayBuffer`. We duck-type the buffer so the package
 * needs no Node type definitions and stays runtime agnostic.
 */
function decode(value: unknown): unknown {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const candidate = value as { toString?: (encoding?: string) => string; constructor?: { name?: string } };
    if (candidate.constructor?.name === 'Buffer' && typeof candidate.toString === 'function') {
      return candidate.toString('utf8');
    }
  }
  return value;
}

export type { WidgetSnapshot };

