import { Emitter } from './emitter';
import type { WidgetStore, StoreEvents } from './store';
import type { DataTransport, DataTransportEvents } from './transport/types';
import type { TransportStatus, WidgetSnapshot } from './types';

export interface ConnectorEvents {
  snapshot: WidgetSnapshot;
  status: TransportStatus;
  error: Error;
}

/**
 * Glues a transport to a store: every snapshot the transport emits lands in the
 * store (with history bookkeeping), every status change is re-broadcast so the
 * widget can render a connection pill.
 *
 * Kept transport-agnostic so hosts can swap the pipeline (native bridge, gRPC,
 * SharedWorker, ...) without touching the renderer.
 */
export class WidgetConnector {
  private readonly events = new Emitter<ConnectorEvents>();
  private unsubscribers: Array<() => void> = [];

  constructor(
    private transport: DataTransport,
    private store: WidgetStore,
  ) {}

  get status(): TransportStatus {
    return this.transport.status;
  }

  get kind(): string {
    return this.transport.kind;
  }

  on<K extends keyof ConnectorEvents>(event: K, listener: (payload: ConnectorEvents[K]) => void): () => void {
    return this.events.on(event, listener);
  }

  /** Forward store events straight to connector listeners (`update`, `alert`, ...). */
  forwardStoreEvents(keys: Array<keyof StoreEvents> = ['alert']): void {
    for (const key of keys) {
      this.unsubscribers.push(this.store.on(key, (payload) => this.events.emit(key as never, payload as never)));
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
  async replaceTransport(next: DataTransport): Promise<void> {
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
