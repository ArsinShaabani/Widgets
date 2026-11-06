import { describe, expect, it } from 'vitest';
import {
  createMockSnapshot,
  createTranslator,
  mergeThresholds,
  resolveTheme,
  WidgetStore,
  type MetricHistory,
} from '@widgets/core';
import { buildViewModel } from '../src/index';

const theme = resolveTheme('dark');
const t = createTranslator('en');
const thresholds = mergeThresholds();

function emptyHistory(): MetricHistory {
  return { cpu: [], memory: [], disk: [], networkRx: [], networkTx: [], load: [] };
}

describe('buildViewModel', () => {
  it('renders a pending view model before the first snapshot', () => {
    const vm = buildViewModel({ snapshot: null, history: emptyHistory(), theme, thresholds, t });
    expect(vm.pending).toBe(true);
    expect(vm.connection.label).toBe('Connecting');
    expect(vm.cpuBars.items).toEqual([]);
    expect(vm.gauges).toHaveLength(3);
    expect(vm.badges.map((badge) => badge.index)).toEqual(['01', '02', '03']);
  });

  it('maps a snapshot onto every dashboard section', () => {
    const snapshot = createMockSnapshot({ elapsedSeconds: 30 });
    const store = new WidgetStore();
    store.update(snapshot);
    const vm = buildViewModel({
      snapshot,
      history: store.historySnapshot(),
      theme,
      thresholds,
      t,
      connectionState: 'live',
      now: snapshot.timestamp,
    });

    expect(vm.pending).toBe(false);
    expect(vm.host.name).toBe(snapshot.host.name);
    expect(vm.host.initials.length).toBeGreaterThan(0);
    expect(vm.gauges.map((g) => g.id)).toEqual(['cpu', 'memory', 'disk']);
    expect(vm.gauges[0]!.valueLabel).toBe(`${Math.round(snapshot.cpu.usage)}%`);
    expect(vm.donuts.map((d) => d.id)).toEqual(['memory', 'disk', 'swap']);
    expect(vm.cpuBars.items.length).toBe(Math.min(16, snapshot.cpu.perCore.length));
    expect(vm.badges).toHaveLength(3);
    expect(vm.resourceBars.length).toBeGreaterThan(0);
    expect(vm.dualBars).toHaveLength(3);
    expect(vm.actions).toHaveLength(6);
    expect(vm.network.series.map((s) => s.id)).toEqual(['rx', 'tx']);
    expect(vm.connection.label).toBe('Live');
    expect(vm.connection.description).toMatch(/^Updated \d+s$/);
  });

  it('derives status colours from thresholds', () => {
    const snapshot = createMockSnapshot({ elapsedSeconds: 5 });
    const stressed = {
      ...snapshot,
      cpu: { ...snapshot.cpu, usage: 95 },
      memory: { ...snapshot.memory, usage: 95 },
      disk: { ...snapshot.disk, usage: 95 },
    };
    const vm = buildViewModel({ snapshot: stressed, history: emptyHistory(), theme, thresholds, t });
    expect(vm.status).toBe('critical');
    expect(vm.badges.every((badge) => badge.status === 'critical')).toBe(true);
  });

  it('exposes alerts on the host card', () => {
    const snapshot = createMockSnapshot({ elapsedSeconds: 5 });
    const withAlert = {
      ...snapshot,
      alerts: [{ id: 'a1', title: 'Disk usage high', severity: 'warning' as const, message: 'root at 88%' }],
    };
    const vm = buildViewModel({ snapshot: withAlert, history: emptyHistory(), theme, thresholds, t });
    expect(vm.alertCount).toBe(1);
    expect(vm.alerts[0]!.title).toBe('Disk usage high');
  });

  it('respects hidden sections and locale overrides', () => {
    const snapshot = createMockSnapshot({ elapsedSeconds: 5 });
    const fa = createTranslator('fa');
    const vm = buildViewModel({
      snapshot,
      history: emptyHistory(),
      theme,
      thresholds,
      t: fa,
      hiddenSections: { donuts: false, actions: false },
    });
    expect(vm.hidden.has('donuts')).toBe(true);
    expect(vm.gauges[0]!.label).toBe('پردازنده');
  });

  it('computes the network axis from the history peak', () => {
    const snapshot = createMockSnapshot({ elapsedSeconds: 40 });
    const history = emptyHistory();
    history.networkRx = [
      { t: 1, v: 1024 },
      { t: 2, v: 3 * 1024 ** 3 },
    ];
    history.networkTx = [
      { t: 1, v: 512 },
      { t: 2, v: 1024 ** 3 },
    ];
    const vm = buildViewModel({ snapshot, history, theme, thresholds, t });
    expect(vm.network.max).toBeGreaterThanOrEqual(3 * 1024 ** 3);
    expect(vm.network.ticks[0]).toBe(0);
    expect(vm.network.ticks.at(-1)).toBe(vm.network.max);
  });
});
