import type { ConnectionState, TransportStatus, WidgetSnapshot } from '../types';

/**
 * Converts a raw payload into a widget's canonical snapshot.
 * Widgets plug their own normaliser into the transports, so one transport
 * implementation serves every widget in the collection.
 */
export type SnapshotNormalizer<T> = (payload: unknown) => T | null;

export interface DataTransportEvents<T> {
  /** A snapshot was parsed successfully. */
  snapshot: T;
  /** Connection lifecycle change. */
  status: TransportStatus;
  /** Non-fatal problem (parse failure, transient HTTP error, ...). */
  error: Error;
}

/** Common surface implemented by every data source. */
export interface DataTransport<T = WidgetSnapshot> {
  /** Stable id used in logs/diagnostics. */
  readonly kind: string;
  /** Current lifecycle state. */
  readonly status: TransportStatus;
  /** Start streaming; resolves once the first connection attempt settled. */
  start(): Promise<void>;
  /** Stop streaming and release every resource. */
  stop(): void;
  /** Subscribe to transport events; returns an unsubscribe function. */
  subscribe<K extends keyof DataTransportEvents<T>>(
    event: K,
    listener: (payload: DataTransportEvents<T>[K]) => void,
  ): () => void;
  /** Optional: ask the source for a one-off refresh (used by the retry button). */
  refresh?(): void;
}

/** Backoff schedule shared by the reconnecting transports. */
export interface BackoffOptions {
  /** First retry delay in ms (default 500). */
  baseDelay?: number;
  /** Upper bound in ms (default 15000). */
  maxDelay?: number;
  /** Multiplier applied per attempt (default 1.8). */
  factor?: number;
  /** Random jitter ratio 0..1 (default 0.25). */
  jitter?: number;
}

export function nextBackoff(attempt: number, options: BackoffOptions = {}): number {
  const { baseDelay = 500, maxDelay = 15_000, factor = 1.8, jitter = 0.25 } = options;
  const raw = Math.min(maxDelay, baseDelay * factor ** Math.max(0, attempt - 1));
  const noise = raw * jitter * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(raw + noise));
}

/** Initial status object for a fresh transport/state pair. */
export function initialStatus(state: ConnectionState = 'idle'): TransportStatus {
  return { state, received: 0, lastMessageAt: 0, error: null, attempts: 0 };
}

/** Normalises anything thrown into an `Error`. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : JSON.stringify(value));
}
