import { Emitter } from '../emitter';
import { normalizeSnapshot } from '../normalize';
import type { TransportStatus, WidgetSnapshot } from '../types';
import {
  type DataTransport,
  type DataTransportEvents,
  type BackoffOptions,
  type SnapshotNormalizer,
  initialStatus,
  toError,
} from './types';

/** Shared plumbing for every transport: emitter, status bookkeeping, parsing. */
export abstract class BaseTransport<T = WidgetSnapshot> implements DataTransport<T> {
  abstract readonly kind: string;
  protected readonly events = new Emitter<DataTransportEvents<T>>();
  protected currentStatus = initialStatus();
  protected stopped = true;
  protected readonly backoff: BackoffOptions;
  /** Widget specific payload mapper; defaults to the server-metrics normaliser. */
  protected readonly normalize: SnapshotNormalizer<T>;

  protected constructor(options: { backoff?: BackoffOptions; normalize?: SnapshotNormalizer<T> } = {}) {
    this.backoff = options.backoff ?? {};
    this.normalize = options.normalize ?? (normalizeSnapshot as unknown as SnapshotNormalizer<T>);
  }

  get status(): TransportStatus {
    return this.currentStatus;
  }

  subscribe<K extends keyof DataTransportEvents<T>>(
    event: K,
    listener: (payload: DataTransportEvents<T>[K]) => void,
  ): () => void {
    return this.events.on(event, listener);
  }

  abstract start(): Promise<void>;

  stop(): void {
    this.stopped = true;
    this.patchStatus({ state: 'closed' });
  }

  protected patchStatus(patch: Partial<TransportStatus>): void {
    this.currentStatus = { ...this.currentStatus, ...patch };
    this.events.emit('status', this.currentStatus);
  }

  /**
   * Parse + validate an inbound payload through the widget's normaliser.
   *
   * Returning `null` from a normaliser (unknown shape, control frame) leaves the
   * previous snapshot on screen and does not count as a received message.
   */
  protected ingest(payload: unknown): T | null {
    try {
      const snapshot = this.normalize(payload);
      if (!snapshot) return null;
      this.patchStatus({
        state: 'live',
        received: this.currentStatus.received + 1,
        lastMessageAt: Date.now(),
        error: null,
        attempts: 0,
      });
      this.events.emit('snapshot', snapshot);
      return snapshot;
    } catch (error) {
      const err = toError(error);
      this.events.emit('error', err);
      return null;
    }
  }

  protected fail(error: unknown): void {
    const err = toError(error);
    this.patchStatus({ state: 'error', error: err });
    this.events.emit('error', err);
  }
}
