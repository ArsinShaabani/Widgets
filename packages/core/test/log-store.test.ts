import { describe, expect, it, vi } from 'vitest';
import { LogStore } from '../src/log-store';
import { createMockLogEntry, createMockLogSnapshot } from '../src/log-mock';
import { emptyLogFilter, type LogEntry } from '../src/log-types';

const entry = (message: string, level: LogEntry['level'] = 'info', service = 'api', at = Date.now()): LogEntry => ({
  id: `${message}-${at}`,
  timestamp: at,
  level,
  service,
  message,
});

describe('LogStore', () => {
  it('buffers entries, bounds the ring and counts levels/services', () => {
    const store = new LogStore({ maxEntries: 50, collapseRepeats: false });
    store.append(Array.from({ length: 120 }, (_, i) => entry(`line ${i}`, i % 10 === 0 ? 'error' : 'info')));

    expect(store.size).toBe(50);
    const stats = store.stats();
    expect(stats.received).toBe(120);
    expect(stats.total).toBe(50);
    expect(stats.byLevel.error).toBeGreaterThan(0);
    expect(stats.byService[0]!.service).toBe('api');
  });

  it('collapses repeated identical lines into one entry with a counter', () => {
    const store = new LogStore({ now: () => 1_000_000 });
    store.append([entry('boom', 'error', 'api', 1_000_000)]);
    store.append([entry('boom', 'error', 'api', 1_000_100)]);
    store.append([entry('boom', 'error', 'api', 1_000_200)]);

    const buffered = store.entries();
    expect(buffered).toHaveLength(1);
    expect(buffered[0]!.repeat).toBe(3);
    // Repeated lines only count once towards the totals.
    expect(store.stats().received).toBe(1);
  });

  it('does not collapse across different services or after the repeat window', () => {
    const store = new LogStore({ now: () => 1_000_000, repeatWindowMs: 500 });
    store.append([entry('boom', 'error', 'api', 1_000_000)]);
    store.append([entry('boom', 'error', 'worker', 1_000_100)]);
    store.append([entry('boom', 'error', 'worker', 1_002_000)]);
    expect(store.entries()).toHaveLength(3);
  });

  it('filters by level, minLevel, service and free text', () => {
    const store = new LogStore({ collapseRepeats: false });
    store.append([
      entry('request ok', 'info', 'api'),
      entry('upstream timeout', 'error', 'api'),
      entry('queue depth high', 'warn', 'worker'),
      { ...entry('tenant quota', 'info', 'billing'), attributes: { tenant: 'acme' } },
    ]);

    expect(store.filtered({ ...emptyLogFilter, minLevel: 'error' })).toHaveLength(1);
    expect(store.filtered({ ...emptyLogFilter, levels: ['warn'] })).toHaveLength(1);
    expect(store.filtered({ ...emptyLogFilter, services: ['api'] })).toHaveLength(2);
    expect(store.filtered({ ...emptyLogFilter, query: 'timeout' })).toHaveLength(1);
    expect(store.filtered({ ...emptyLogFilter, query: 'acme' })).toHaveLength(1);
    expect(store.filtered({ ...emptyLogFilter, query: 'WORKER' })).toHaveLength(1);
  });

  it('limits the filtered tail and caches the result until the store changes', () => {
    const store = new LogStore({ collapseRepeats: false });
    store.append(Array.from({ length: 10 }, (_, i) => entry(`line ${i}`)));

    const first = store.filtered(emptyLogFilter, 3);
    const second = store.filtered(emptyLogFilter, 3);
    expect(first.map((e) => e.message)).toEqual(['line 7', 'line 8', 'line 9']);
    expect(second).toBe(first); // cached, same reference

    store.append([entry('line 10')]);
    expect(store.filtered(emptyLogFilter, 3).map((e) => e.message)).toEqual(['line 8', 'line 9', 'line 10']);
  });

  it('builds a rolled-up histogram aligned to the bucket grid', () => {
    let clock = 1_000_000;
    const store = new LogStore({ bucketMs: 1000, bucketCount: 5, now: () => clock, collapseRepeats: false });
    store.append([entry('a', 'info', 'api', 1_000_000), entry('b', 'error', 'api', 1_000_500)]);

    const buckets = store.histogram();
    expect(buckets).toHaveLength(5);
    const occupied = buckets.filter((bucket) => bucket.total > 0);
    expect(occupied).toHaveLength(1);
    expect(occupied[0]!.counts.info).toBe(1);
    expect(occupied[0]!.counts.error).toBe(1);

    // Moving the clock forward drops the old bucket out of the window.
    clock = 1_010_000;
    expect(store.histogram().some((bucket) => bucket.total > 0)).toBe(false);
  });

  it('emits append, critical and stats events, and reports the error rate', () => {
    const store = new LogStore({ collapseRepeats: false });
    const onAppend = vi.fn();
    const onCritical = vi.fn();
    const onStats = vi.fn();
    store.on('append', onAppend);
    store.on('critical', onCritical);
    store.on('stats', onStats);

    store.append([entry('fine'), entry('kaboom', 'error')]);

    expect(onAppend).toHaveBeenCalledTimes(1);
    expect(onCritical).toHaveBeenCalledTimes(1);
    expect(onStats).toHaveBeenCalledTimes(1);
    expect(store.stats().errorRate).toBeGreaterThan(0);
    expect(store.activeLevels()).toContain('error');
  });

  it('clears the buffer and notifies listeners', () => {
    const store = new LogStore();
    const onReset = vi.fn();
    store.on('reset', onReset);
    store.append([entry('a')]);
    store.clear();

    expect(store.size).toBe(0);
    expect(store.stats().received).toBe(0);
    expect(store.services()).toEqual([]);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('accepts snapshots through the sink interface', () => {
    const store = new LogStore();
    store.update({ timestamp: Date.now(), entries: [entry('via sink')] });
    expect(store.tail(1)[0]!.message).toBe('via sink');
  });
});

describe('createMockLogSnapshot', () => {
  it('is deterministic for a given seed and timeline', () => {
    const first = createMockLogSnapshot({ seed: 7, elapsedSeconds: 100, count: 5 });
    const second = createMockLogSnapshot({ seed: 7, elapsedSeconds: 100, count: 5 });
    expect(first.entries.map((e) => e.message)).toEqual(second.entries.map((e) => e.message));
    expect(first.entries).toHaveLength(5);
  });

  it('produces lines the store accepts', () => {
    const store = new LogStore({ collapseRepeats: false });
    for (let second = 0; second < 30; second += 1) {
      store.update(createMockLogSnapshot({ elapsedSeconds: second, count: 6 }));
    }
    const stats = store.stats();
    expect(stats.received).toBe(180);
    expect(stats.byService.length).toBeGreaterThan(1);
    expect(Object.values(stats.byLevel).reduce((sum, value) => sum + value, 0)).toBe(180);
  });

  it('can force an incident burst', () => {
    const burst = createMockLogSnapshot({ burst: true, count: 20, elapsedSeconds: 42 });
    const severe = burst.entries.filter((e) => e.level === 'error' || e.level === 'fatal');
    expect(severe.length).toBeGreaterThan(5);
  });

  it('builds single entries for tests', () => {
    const single = createMockLogEntry('warn', 'careful', { service: 'edge' });
    expect(single).toMatchObject({ level: 'warn', message: 'careful', service: 'edge' });
  });
});
