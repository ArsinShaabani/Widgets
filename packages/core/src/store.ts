import { Emitter } from './emitter';
import { mergeThresholds, swapUsagePercent } from './thresholds';
import type { MetricHistory, TimeSeriesPoint, WidgetSnapshot } from './types';
import type { ThresholdConfig } from './types';

export interface StoreEvents {
  /** A new snapshot replaced the current one. */
  update: { current: WidgetSnapshot; previous: WidgetSnapshot | null };
  /** A history buffer received a new point. */
  history: MetricHistory;
  /** A metric crossed a threshold boundary (or recovered). */
  alert: { metric: string; from: string; to: string; value: number };
}

export interface StoreOptions {
  /** Number of points kept per series (default 120). */
  historySize?: number;
  thresholds?: Partial<ThresholdConfig>;
  /** Clock injection point for tests. */
  now?: () => number;
}

const EMPTY_HISTORY: MetricHistory = {
  cpu: [],
  memory: [],
  disk: [],
  networkRx: [],
  networkTx: [],
  load: [],
};

/**
 * Holds the latest snapshot plus rolling history for every series a widget may
 * chart. Framework free: the canvas renderer subscribes and repaints, React
 * bindings would subscribe and `setState`, native shells can poll `history()`.
 */
export class WidgetStore {
  private readonly events = new Emitter<StoreEvents>();
  private readonly historySize: number;
  private readonly now: () => number;
  private history: MetricHistory = cloneHistory(EMPTY_HISTORY);
  private current: WidgetSnapshot | null = null;
  private thresholds: ThresholdConfig;
  private lastStatus = new Map<string, string>();

  constructor(options: StoreOptions = {}) {
    this.historySize = Math.max(2, options.historySize ?? 120);
    this.now = options.now ?? (() => Date.now());
    this.thresholds = mergeThresholds(options.thresholds);
  }

  get on(): Emitter<StoreEvents>['on'] {
    return this.events.on.bind(this.events);
  }

  get once(): Emitter<StoreEvents>['once'] {
    return this.events.once.bind(this.events);
  }

  get off(): Emitter<StoreEvents>['off'] {
    return this.events.off.bind(this.events);
  }

  /** Latest snapshot, or `null` before the first message arrives. */
  get snapshot(): WidgetSnapshot | null {
    return this.current;
  }

  /** Full history buffers (frozen copies). */
  historySnapshot(): MetricHistory {
    return cloneHistory(this.history);
  }

  /** One series, optionally limited to the last `limit` points. */
  series(key: keyof MetricHistory, limit?: number): TimeSeriesPoint[] {
    const points = this.history[key];
    return limit == null ? [...points] : points.slice(-limit);
  }

  /** Update thresholds at runtime (from widget config or a remote config push). */
  setThresholds(thresholds: Partial<ThresholdConfig>): void {
    this.thresholds = mergeThresholds(thresholds);
  }

  getThresholds(): ThresholdConfig {
    return this.thresholds;
  }

  /** Push a new snapshot: updates history, derives alerts and notifies listeners. */
  update(snapshot: WidgetSnapshot): void {
    const previous = this.current;
    this.current = snapshot;
    const t = snapshot.timestamp || this.now();

    this.push('cpu', t, snapshot.cpu.usage);
    this.push('memory', t, snapshot.memory.usage);
    this.push('disk', t, snapshot.disk.usage);
    this.push('networkRx', t, snapshot.network.rxBytesPerSec);
    this.push('networkTx', t, snapshot.network.txBytesPerSec);
    this.push('load', t, snapshot.cpu.load[0]);

    this.events.emit('update', { current: snapshot, previous });
    this.events.emit('history', this.historySnapshot());
    this.detectTransitions(snapshot);
  }

  /** Forget every buffered point (used when switching data source). */
  clear(): void {
    this.history = cloneHistory(EMPTY_HISTORY);
    this.current = null;
    this.lastStatus.clear();
  }

  dispose(): void {
    this.events.clear();
    this.clear();
  }

  private push(key: keyof MetricHistory, t: number, v: number): void {
    const buffer = this.history[key];
    buffer.push({ t, v });
    if (buffer.length > this.historySize) buffer.splice(0, buffer.length - this.historySize);
  }

  /** Emits `alert` events when a metric changes status bucket. */
  private detectTransitions(snapshot: WidgetSnapshot): void {
    const readings: Array<[string, number, { warning: number; critical: number }]> = [
      ['cpu', snapshot.cpu.usage, this.thresholds.cpu],
      ['memory', snapshot.memory.usage, this.thresholds.memory],
      ['disk', snapshot.disk.usage, this.thresholds.disk],
      [
        'swap',
        swapUsagePercent(snapshot.memory.swapUsed, snapshot.memory.swapTotal),
        this.thresholds.swap,
      ],
      ['latency', snapshot.network.latencyMs ?? 0, this.thresholds.latency],
    ];

    for (const [metric, value, rule] of readings) {
      const status = value >= rule.critical ? 'critical' : value >= rule.warning ? 'warning' : 'ok';
      const previous = this.lastStatus.get(metric);
      this.lastStatus.set(metric, status);
      if (previous && previous !== status) {
        this.events.emit('alert', { metric, from: previous, to: status, value });
      }
    }
  }
}

function cloneHistory(history: MetricHistory): MetricHistory {
  return {
    cpu: [...history.cpu],
    memory: [...history.memory],
    disk: [...history.disk],
    networkRx: [...history.networkRx],
    networkTx: [...history.networkTx],
    load: [...history.load],
  };
}
