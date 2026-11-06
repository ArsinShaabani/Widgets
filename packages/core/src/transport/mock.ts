import { createMockSnapshot, type MockSnapshotOptions } from '../mock';
import { BaseTransport } from './base';

export interface MockTransportOptions extends MockSnapshotOptions {
  /** Emit cadence in ms (default 1500). */
  intervalMs?: number;
  /** Start paused (useful for tests that drive it manually). */
  autostart?: boolean;
}

/**
 * In-process synthetic source.
 *
 * Powers the demo app, the docs playground and unit tests so a widget can be
 * developed without any backend running.
 */
export class MockTransport extends BaseTransport {
  readonly kind = 'mock';
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;
  private readonly options: MockTransportOptions;

  constructor(options: MockTransportOptions = {}) {
    super();
    this.options = { intervalMs: 1500, ...options };
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
    const elapsedSeconds = (this.options.elapsedSeconds ?? 0) + this.tick * ((this.options.intervalMs ?? 1500) / 1000);
    this.tick += 1;
    this.ingest(createMockSnapshot({ ...this.options, elapsedSeconds }));
  }
}
