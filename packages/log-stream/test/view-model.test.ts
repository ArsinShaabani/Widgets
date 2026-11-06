import { describe, expect, it } from 'vitest';
import {
  LogStore,
  createMockLogSnapshot,
  createTranslator,
  emptyLogFilter,
  resolveTheme,
  type LogEntry,
} from '@widgets/core';
import { buildLogViewModel, relativeLabel, timeLabel } from '../src/index';

const theme = resolveTheme('dark');
const t = createTranslator('en');

const entry = (message: string, level: LogEntry['level'] = 'info', service = 'api', at = Date.now()): LogEntry => ({
  id: `${message}-${at}`,
  timestamp: at,
  level,
  service,
  message,
});

function build(store: LogStore, overrides: Partial<Parameters<typeof buildLogViewModel>[0]> = {}) {
  return buildLogViewModel({
    store,
    theme,
    t,
    filters: { ...emptyLogFilter },
    selectionId: null,
    scrollTop: 0,
    follow: true,
    rowHeight: 26,
    first: 0,
    count: 10,
    connectionState: 'live',
    ...overrides,
  });
}

describe('log view model', () => {
  it('renders a waiting state before the first batch', () => {
    const vm = build(new LogStore());
    expect(vm.stream.pending).toBe(true);
    expect(vm.stream.rows).toEqual([]);
    expect(vm.stream.emptyMessage).toBe('Waiting for the first line');
    expect(vm.toolbar.connection.label).toBe('Live');
  });

  it('materialises only the requested window of rows', () => {
    const store = new LogStore({ collapseRepeats: false });
    store.append(Array.from({ length: 100 }, (_, i) => entry(`line ${i}`)));

    const window = build(store, { first: 40, count: 5 });
    expect(window.stream.rows.map((row) => row.message)).toEqual([
      'line 40',
      'line 41',
      'line 42',
      'line 43',
      'line 44',
    ]);
    expect(window.stream.filteredTotal).toBe(100);
    expect(window.stream.rows[0]!.index).toBe(40);
    expect(window.stream.rows[0]!.timeLabel).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it('marks the selected row and collapses repeats', () => {
    const store = new LogStore({ now: () => 1_000_000 });
    store.append([entry('boom', 'error', 'api', 1_000_000)]);
    store.append([entry('boom', 'error', 'api', 1_000_100)]);
    const vm = build(store, { selectionId: store.entries()[0]!.id, now: 1_000_000 });

    expect(vm.stream.rows).toHaveLength(1);
    expect(vm.stream.rows[0]!.repeat).toBe(2);
    expect(vm.stream.rows[0]!.selected).toBe(true);
    expect(vm.stream.rows[0]!.color).toBe(theme.levels.error);
    expect(vm.detail.entry?.message).toBe('boom');
    expect(vm.detail.rows.map((row) => row.label)).toContain('repeat');
  });

  it('builds filter chips with counts and active flags', () => {
    const store = new LogStore({ collapseRepeats: false });
    store.append([entry('a', 'info'), entry('b', 'error'), entry('c', 'warn', 'worker')]);

    const vm = build(store);
    expect(vm.filters.levels[0]).toMatchObject({ level: 'all', count: 3, active: true });
    expect(vm.filters.levels.find((chip) => chip.level === 'error')!.count).toBe(1);
    expect(vm.filters.levels.find((chip) => chip.level === 'debug')!.count).toBe(0);
    expect(vm.filters.services.map((chip) => chip.service).sort()).toEqual(['api', 'worker']);

    const filtered = build(store, { filters: { ...emptyLogFilter, levels: ['error'] } });
    expect(filtered.filters.levels.find((chip) => chip.level === 'error')!.active).toBe(true);
    expect(filtered.filters.levels[0]!.active).toBe(false);
    expect(filtered.filters.activeCount).toBe(1);
    expect(filtered.stream.filteredTotal).toBe(1);
  });

  it('aggregates severity mix, histogram and services', () => {
    let clock = 1_000_000;
    const store = new LogStore({ now: () => clock, bucketMs: 1000, bucketCount: 6, collapseRepeats: false });
    store.append([
      entry('ok', 'info', 'api', 1_000_000),
      entry('bad', 'error', 'api', 1_000_100),
      entry('meh', 'warn', 'worker', 1_000_200),
    ]);

    const vm = build(store);
    expect(vm.severityMix.total).toBe(3);
    expect(vm.severityMix.segments.map((segment) => segment.level)).toEqual(['info', 'warn', 'error']);
    expect(vm.severityMix.errorRate).toBeGreaterThan(0);
    expect(vm.histogram.buckets).toHaveLength(6);
    expect(vm.histogram.max).toBeGreaterThanOrEqual(3);
    expect(vm.services[0]!.service).toBe('api');
    expect(vm.services[0]!.errorCount).toBe(1);
    expect(vm.services[0]!.percent).toBeCloseTo(100, 5);
    clock += 10_000;
  });
});

describe('log view model — toolbar, i18n and generator', () => {
  it('counts errors and reports them in the toolbar', () => {
    const store = new LogStore({ collapseRepeats: false });
    store.append([entry('a', 'info'), entry('b', 'error'), entry('c', 'fatal')]);
    const vm = build(store);
    const errors = vm.toolbar.counters.find((counter) => counter.id === 'errors')!;
    expect(errors.value).toBe('2');
    expect(errors.tone).toBe('critical');
  });

  it('derives action labels from the follow state and selection', () => {
    const store = new LogStore({ collapseRepeats: false });
    store.append([entry('a')]);

    const paused = build(store, { follow: false });
    expect(paused.toolbar.actions.find((action) => action.id === 'follow')!.label).toBe('Resume');
    expect(paused.toolbar.actions.find((action) => action.id === 'copy')!.disabled).toBe(true);

    const selected = build(store, { selectionId: store.entries()[0]!.id });
    expect(selected.toolbar.actions.find((action) => action.id === 'copy')!.disabled).toBe(false);
  });

  it('translates into other locales', () => {
    const fa = createTranslator('fa');
    const store = new LogStore();
    const vm = build(store, { t: fa });
    expect(vm.toolbar.title).toBe('جریان زنده لاگ');
    expect(vm.stream.emptyMessage).toBe('در انتظار اولین خط');
  });

  it('honours hidden sections', () => {
    const vm = build(new LogStore(), { hiddenSections: { services: false, histogram: false } });
    expect(vm.hidden.has('services')).toBe(true);
    expect(vm.hidden.has('histogram')).toBe(true);
  });

  it('works with the synthetic generator', () => {
    const store = new LogStore({ collapseRepeats: false });
    for (let second = 0; second < 5; second += 1) {
      store.update(createMockLogSnapshot({ elapsedSeconds: second, count: 8 }));
    }
    const vm = build(store, { count: 20 });
    expect(vm.stream.rows).toHaveLength(20);
    expect(vm.stream.pending).toBe(false);
    expect(vm.services.length).toBeGreaterThan(0);
  });
});

describe('time labels', () => {
  it('formats absolute and relative timestamps', () => {
    expect(timeLabel(Date.parse('2026-11-06T10:20:30.456Z'))).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    const now = Date.now();
    expect(relativeLabel(now - 5_000, now)).toBe('5s ago');
    expect(relativeLabel(now - 120_000, now)).toBe('2m ago');
    expect(relativeLabel(now - 7_200_000, now)).toBe('2h ago');
    expect(relativeLabel(now, now)).toBe('now');
  });
});

