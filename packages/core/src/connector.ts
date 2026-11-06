import { Emitter } from './emitter';
import type { TransportStatus } from './types';
import type { DataTransport, DataTransportEvents } from './transport/types';

/** Anything that can absorb canonical snapshots (widget stores implement this). */
export interface SnapshotSink<T> {
  update(snapshot: T): void;
}

export interface ConnectorEvents<T> {
  snapshot: T;
  status: TransportStatus;
  error: Error;
}

/**
 * Glues a transport to a store: every snapshot the transport emits lands in the
 * store (with history/stats bookkeeping), every status change is re-broadcast so
 * the widget can render a connection pill.
 *
 * Kept transport-agnostic and store-agnostic so hosts can swap the pipeline
 * (native bridge, gRPC, SharedWorker, ...) without touching the renderer.
 */
export class WidgetConnector<T = import('./types').WidgetSnapshot> {
  private readonly events = new Emitter<ConnectorEvents<T>>();
  private unsubscribers: Array<() => void> = [];

  constructor(
    private transport: DataTransport<T>,
    private store: SnapshotSink<T>,
  ) {}

  get status(): TransportStatus {
    return this.transport.status;
  }

  get kind(): string {
    return this.transport.kind;
  }

  on<K extends keyof ConnectorEvents<T>>(event: K, listener: (payload: ConnectorEvents<T>[K]) => void): () => void {
    return this.events.on(event, listener);
  }

  /** Forward store events straight to connector listeners (`alert`, `stats`, ...). */
  forwardStoreEvents(sink: {
    on(event: never, listener: (payload: never) => void): () => void;
  }, keys: string[] = ['alert']): void {
    for (const key of keys) {
      this.unsubscribers.push(
        sink.on(key as never, ((payload: unknown) => this.events.emit(key as never, payload as never)) as never),
      );
    }
  }

  async start(): Promise<void> {
    this.unsubscribers.push(
      this.transport.subscribe('snapshot', (snapshot) => {
        this.store.update(snapshot);
        this.events.emit('snapshot', snapshot);
      }),
      this.transport.subscribe('status', (status) => this.events.emit('status', status)),
      this.transport.subscribe('error', (error) => this.events.emit('error', error)),
    );
    await this.transport.start();
  }

  /** Swap the data source at runtime, preserving the store contents. */
  async replaceTransport(next: DataTransport<T>): Promise<void> {
    this.stop();
    this.transport = next;
    this.unsubscribers = [];
    await this.start();
  }

  refresh(): void {
    this.transport.refresh?.();
  }

  stop(): void {
    this.transport.stop();
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }

  dispose(): void {
    this.stop();
    this.events.clear();
  }
}

export type { DataTransportEvents };
