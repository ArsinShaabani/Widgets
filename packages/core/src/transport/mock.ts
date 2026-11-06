import { createMockSnapshot, type MockSnapshotOptions } from '../mock';
import { BaseTransport } from './base';
import type { WidgetSnapshot } from '../types';

export interface MockTransportOptions<T = WidgetSnapshot> extends MockSnapshotOptions {
  /** Emit cadence in ms (default 1500). */
  intervalMs?: number;
  /** In-process snapshot factory; defaults to the server-metrics generator. */
  factory?: () => T;
  /** Widget specific payload mapper (defaults to the server-metrics normaliser). */
  normalize?: import('./types').SnapshotNormalizer<T>;
}

/**
 * In-process synthetic source.
 *
 * Powers the demo app, the docs playground and unit tests so a widget can be
 * developed without any backend running. Widgets inject their own `factory`.
 */
export class MockTransport<T = WidgetSnapshot> extends BaseTransport<T> {
  readonly kind = 'mock';
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;
  private readonly options: MockTransportOptions<T>;
  private readonly factory: () => T;

  constructor(options: MockTransportOptions<T> = {}) {
    super({ normalize: options.normalize });
    this.options = { intervalMs: 1500, ...options };
    this.factory =
      options.factory ??
      ((() => createMockSnapshot({ ...options, elapsedSeconds: this.nextElapsed() })) as unknown as () => T);
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.patchStatus({ state: 'connecting' });
    this.pushOne();
    const intervalMs = this.options.intervalMs ?? 1500;
    if (intervalMs > 0) {
      this.timer = setInterval(() => this.pushOne(), intervalMs);
    }
  }

  override stop(): void {
    super.stop();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  refresh(): void {
    this.pushOne();
  }

  /** Emit a snapshot immediately (also used by deterministic tests). */
  pushOne(): void {
    this.tick += 1;
    this.ingest(this.factory());
  }

  private nextElapsed(): number {
    const elapsed = (this.options.elapsedSeconds ?? 0) + this.tick * ((this.options.intervalMs ?? 1500) / 1000);
    return elapsed;
  }
}
