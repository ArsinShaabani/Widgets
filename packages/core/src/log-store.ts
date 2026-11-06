import { Emitter } from './emitter';
import type {
  LogBucket,
  LogEntry,
  LogFilter,
  LogLevel,
  LogServiceStat,
  LogSnapshot,
  LogStats,
} from './log-types';
import { LOG_LEVELS, levelAtLeast } from './log-types';
import type { SnapshotSink } from './connector';

export interface LogStoreEvents {
  /** A batch landed in the buffer. */
  append: { entries: LogEntry[]; total: number };
  /** The buffer was cleared. */
  reset: { total: number };
  /** An error/fatal line arrived (host notifications, counters). */
  critical: LogEntry;
  /** Aggregated counters changed. */
  stats: LogStats;
}

export interface LogStoreOptions {
  /** Maximum buffered lines (default 2000). */
  maxEntries?: number;
  /** Histogram bucket width in ms (default 1000). */
  bucketMs?: number;
  /** Number of histogram buckets kept (default 60). */
  bucketCount?: number;
  /** Clock injection point for tests. */
  now?: () => number;
  /** Collapse identical consecutive lines into a repeat counter (default true). */
  collapseRepeats?: boolean;
  /** Idle gap in ms after which a repeat chain resets (default 5000). */
  repeatWindowMs?: number;
}

const emptyCounts = (): Record<LogLevel, number> => ({
  trace: 0,
  debug: 0,
  info: 0,
  warn: 0,
  error: 0,
  fatal: 0,
});

/**
 * Bounded, filterable log buffer.
 *
 * Framework free: the canvas renderer subscribes and repaints, native hosts can
 * poll `filtered()` / `stats()`, and tests drive it synchronously.
 */
export class LogStore implements SnapshotSink<LogSnapshot> {
  private readonly events = new Emitter<LogStoreEvents>();
  private readonly maxEntries: number;
  private readonly bucketMs: number;
  private readonly bucketCount: number;
  private readonly now: () => number;
  private readonly collapseRepeats: boolean;
  private readonly repeatWindowMs: number;

  private buffer: LogEntry[] = [];
  private buckets = new Map<number, LogBucket>();
  private levelCounts = emptyCounts();
  private serviceCounts = new Map<string, LogServiceStat>();
  private received = 0;
  private versionValue = 0;
  private errorTimestamps: number[] = [];
  private lastEntry: LogEntry | null = null;
  private filterCache: { signature: string; version: number; result: LogEntry[] } = {
    signature: '',
    version: -1,
    result: [],
  };

  constructor(options: LogStoreOptions = {}) {
    this.maxEntries = Math.max(50, options.maxEntries ?? 2000);
    this.bucketMs = Math.max(100, options.bucketMs ?? 1000);
    this.bucketCount = Math.max(5, options.bucketCount ?? 60);
    this.now = options.now ?? (() => Date.now());
    this.collapseRepeats = options.collapseRepeats ?? true;
    this.repeatWindowMs = options.repeatWindowMs ?? 5000;
  }

  get on(): Emitter<LogStoreEvents>['on'] {
    return this.events.on.bind(this.events);
  }

  get off(): Emitter<LogStoreEvents>['off'] {
    return this.events.off.bind(this.events);
  }

  /** Increments on every mutation — used by caches and change detection. */
  get version(): number {
    return this.versionValue;
  }

  get size(): number {
    return this.buffer.length;
  }

  /** Buffered entries, oldest first. */
  entries(): LogEntry[] {
    return [...this.buffer];
  }

  /** Newest `count` entries, oldest first (ready for tail rendering). */
  tail(count: number): LogEntry[] {
    if (count >= this.buffer.length) return [...this.buffer];
    return this.buffer.slice(this.buffer.length - count);
  }

  /** Implements `SnapshotSink<LogSnapshot>` so a transport can drive the store. */
  update(snapshot: LogSnapshot): void {
    this.append(snapshot.entries);
  }

  append(entries: readonly LogEntry[]): void {
    if (entries.length === 0) return;

    const accepted: LogEntry[] = [];
    for (const entry of entries) {
      const merged = this.maybeCollapse(entry);
      if (merged) {
        accepted.push(merged);
        continue;
      }
      this.track(entry);
      this.buffer.push(entry);
      accepted.push(entry);
      if (entry.level === 'error' || entry.level === 'fatal') this.events.emit('critical', entry);
    }

    if (this.buffer.length > this.maxEntries) {
      this.buffer.splice(0, this.buffer.length - this.maxEntries);
    }

    this.versionValue += 1;
    this.events.emit('append', { entries: accepted, total: this.buffer.length });
    this.events.emit('stats', this.stats());
  }

  /** Applies a filter, cached until the filter or the buffer changes. */
  filtered(filter: LogFilter, limit?: number): LogEntry[] {
    const signature = `${filter.levels.join(',')}|${filter.services.join(',')}|${filter.query}|${filter.minLevel ?? 'all'}|${limit ?? 0}`;
    if (this.filterCache.version === this.versionValue && this.filterCache.signature === signature) {
      return this.filterCache.result;
    }

    const query = filter.query.trim().toLowerCase();
    const levels = new Set(filter.levels);
    const services = new Set(filter.services);
    const minLevel = filter.minLevel && filter.minLevel !== 'all' ? filter.minLevel : null;

    const matched = this.buffer.filter((entry) => {
      if (minLevel && !levelAtLeast(entry.level, minLevel)) return false;
      if (levels.size > 0 && !levels.has(entry.level)) return false;
      if (services.size > 0 && !services.has(entry.service)) return false;
      if (query.length === 0) return true;
      if (entry.message.toLowerCase().includes(query)) return true;
      if (entry.service.toLowerCase().includes(query)) return true;
      if (entry.traceId?.toLowerCase().includes(query)) return true;
      if (entry.attributes) {
        for (const [key, value] of Object.entries(entry.attributes)) {
          if (key.toLowerCase().includes(query) || String(value).toLowerCase().includes(query)) return true;
        }
      }
      return false;
    });

    const result = limit != null && matched.length > limit ? matched.slice(matched.length - limit) : matched;
    this.filterCache = { signature, version: this.versionValue, result };
    return result;
  }


  /** Volume per level over the rolling window, aligned to the bucket grid. */
  histogram(): LogBucket[] {
    const current = Math.floor(this.now() / this.bucketMs);
    this.prune(current);
    const buckets: LogBucket[] = [];
    for (let index = current - this.bucketCount + 1; index <= current; index += 1) {
      buckets.push(this.buckets.get(index) ?? { t: index * this.bucketMs, counts: emptyCounts(), total: 0 });
    }
    return buckets;
  }

  /** Buffered counters plus the recent error rate. */
  stats(): LogStats {
    const cutoff = this.now() - 10_000;
    this.errorTimestamps = this.errorTimestamps.filter((t) => t >= cutoff);
    return {
      total: this.buffer.length,
      received: this.received,
      byLevel: { ...this.levelCounts },
      byService: [...this.serviceCounts.values()].sort((a, b) => b.count - a.count),
      errorRate: Number((this.errorTimestamps.length / 10).toFixed(2)),
    };
  }

  /** Services seen in the buffer, most active first. */
  services(limit = 8): LogServiceStat[] {
    return this.stats().byService.slice(0, limit);
  }

  /** Levels present in the buffer (used to dim empty filter chips). */
  activeLevels(): LogLevel[] {
    return LOG_LEVELS.filter((level) => this.levelCounts[level] > 0);
  }

  clear(): void {
    this.buffer = [];
    this.buckets.clear();
    this.levelCounts = emptyCounts();
    this.serviceCounts.clear();
    this.errorTimestamps = [];
    this.received = 0;
    this.lastEntry = null;
    this.versionValue += 1;
    this.events.emit('reset', { total: 0 });
    this.events.emit('stats', this.stats());
  }

  dispose(): void {
    this.events.clear();
    this.clear();
  }

  /** Collapses identical repeated lines into a single entry with `repeat`. */
  private maybeCollapse(entry: LogEntry): LogEntry | null {
    if (!this.collapseRepeats) return null;
    const last = this.lastEntry;
    if (!last) return null;

    const sameLine =
      last.level === entry.level &&
      last.service === entry.service &&
      last.message === entry.message &&
      entry.timestamp - last.timestamp <= this.repeatWindowMs;
    if (!sameLine) return null;

    const merged: LogEntry = { ...last, timestamp: entry.timestamp, repeat: (last.repeat ?? 1) + 1 };
    if (entry.attributes) merged.attributes = entry.attributes;
    this.buffer[this.buffer.length - 1] = merged;
    this.track(merged, true);
    return merged;
  }

  private track(entry: LogEntry, replacing = false): void {
    this.lastEntry = entry;
    if (!replacing) {
      this.received += 1;
      this.levelCounts[entry.level] += 1;
      const stat = this.serviceCounts.get(entry.service) ?? { service: entry.service, count: 0, errorCount: 0 };
      stat.count += 1;
      if (entry.level === 'error' || entry.level === 'fatal') stat.errorCount += 1;
      this.serviceCounts.set(entry.service, stat);
      if (entry.level === 'error' || entry.level === 'fatal') this.errorTimestamps.push(entry.timestamp);
    }

    const index = Math.floor(entry.timestamp / this.bucketMs);
    const bucket = this.buckets.get(index) ?? { t: index * this.bucketMs, counts: emptyCounts(), total: 0 };
    if (!replacing) {
      bucket.counts[entry.level] += 1;
      bucket.total += 1;
    }
    this.buckets.set(index, bucket);
    this.prune(index);
  }

  private prune(currentIndex: number): void {
    const oldest = currentIndex - this.bucketCount + 1;
    for (const index of this.buckets.keys()) {
      if (index < oldest - 1) this.buckets.delete(index);
    }
  }
}

