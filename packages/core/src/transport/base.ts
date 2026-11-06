import { Emitter } from '../emitter';
import { normalizeSnapshot } from '../normalize';
import type { WidgetSnapshot } from '../types';
import {
  type DataTransport,
  type DataTransportEvents,
  type BackoffOptions,
  initialStatus,
  toError,
} from './types';

/** Shared plumbing for every transport: emitter, status bookkeeping, parsing. */
export abstract class BaseTransport implements DataTransport {
  abstract readonly kind: string;
  protected readonly events = new Emitter<DataTransportEvents>();
  protected currentStatus = initialStatus();
  protected stopped = true;
  protected readonly backoff: BackoffOptions;
  protected readonly thresholds?: import('../types').ThresholdConfig;

  protected constructor(options: { backoff?: BackoffOptions } = {}) {
    this.backoff = options.backoff ?? {};
  }

  get status(): import('../types').TransportStatus {
    return this.currentStatus;
  }

  subscribe<K extends keyof DataTransportEvents>(
    event: K,
    listener: (payload: DataTransportEvents[K]) => void,
  ): () => void {
    return this.events.on(event, listener);
  }

  abstract start(): Promise<void>;

  stop(): void {
    this.stopped = true;
    this.patchStatus({ state: 'closed' });
  }

  protected patchStatus(patch: Partial<import('../types').TransportStatus>): void {
    this.currentStatus = { ...this.currentStatus, ...patch };
    this.events.emit('status', this.currentStatus);
  }

  /**
   * Parse + validate an inbound payload. Accepts either a canonical snapshot or
   * a payload `normalizeSnapshot` understands (flat metrics, exporter shapes...).
   */
  protected ingest(payload: unknown): WidgetSnapshot | null {
    try {
      const snapshot = normalizeSnapshot(payload);
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
