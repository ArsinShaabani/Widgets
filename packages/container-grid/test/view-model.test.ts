import { describe, expect, it } from 'vitest';
import {
  ContainerStore,
  createMockContainer,
  createMockContainerSnapshot,
  createTranslator,
  emptyContainerFilter,
  resolveTheme,
} from '@widgets/core';
import { buildContainerGridViewModel, sortContainers } from '../src/index';

const theme = resolveTheme('dark');
const t = createTranslator('en');

function scene(overrides: Partial<Parameters<typeof buildContainerGridViewModel>[0]> = {}) {
  const store = new ContainerStore();
  store.update(createMockContainerSnapshot({ elapsedSeconds: 100, size: 24, incident: true }));
  return {
    store,
    vm: buildContainerGridViewModel({
      store,
      theme,
      t,
      filters: { ...emptyContainerFilter },
      selectionId: null,
      scrollTop: 0,
      first: 0,
      count: 6,
      columns: 3,
      cardWidth: 260,
      connectionState: 'live',
      ...overrides,
    }),
  };
}

describe('container grid view model', () => {
  it('renders a pending state before the first snapshot', () => {
    const store = new ContainerStore();
    const vm = buildContainerGridViewModel({
      store,
      theme,
      t,
      filters: { ...emptyContainerFilter },
      selectionId: null,
      scrollTop: 0,
      first: 0,
      count: 6,
      columns: 3,
      cardWidth: 260,
    });
    expect(vm.cards.pending).toBe(true);
    expect(vm.cards.items).toEqual([]);
    expect(vm.namespaces).toEqual([]);
  });

  it('materialises only the requested window of cards', () => {
    const { vm } = scene({ first: 3, count: 4 });
    expect(vm.cards.items).toHaveLength(4);
    expect(vm.cards.items[0]!.index).toBe(3);
    expect(vm.cards.filteredTotal).toBe(24);
    expect(vm.cards.items[0]!.cpu.valueLabel).toMatch(/cores/);
    expect(vm.cards.items[0]!.memory.valueLabel.length).toBeGreaterThan(0);
  });

  it('derives status colours, readiness and restart labels', () => {
    const store = new ContainerStore();
    store.update({
      timestamp: Date.now(),
      mode: 'replace',
      containers: [
        createMockContainer({
          id: 'payments/api-1',
          name: 'api-1',
          namespace: 'payments',
          phase: 'failed',
          health: 'critical',
          spec: {
            name: 'api',
            image: 'ghcr.io/acme/api:1.2.3',
            restarts: 7,
            readyContainers: 0,
            totalContainers: 1,
            lastReason: 'OOMKilled',
          },
          cpu: { used: 0.4, limit: 2, percent: 20 },
          memory: { used: 1024 ** 3, limit: 2 * 1024 ** 3, percent: 50 },
          message: 'Back-off restarting failed container',
        }),
      ],
    });
    const vm = buildContainerGridViewModel({
      store,
      theme,
      t,
      filters: { ...emptyContainerFilter },
      selectionId: 'payments/api-1',
      scrollTop: 0,
      first: 0,
      count: 5,
      columns: 3,
      cardWidth: 260,
      connectionState: 'live',
    });

    const card = vm.cards.items[0]!;
    expect(card.statusLabel).toBe('Failed');
    expect(card.statusColor).toBe(theme.status.critical);
    expect(card.restartsLabel).toBe('7 restarts');
    expect(card.note).toBe('Back-off restarting failed container');
    expect(card.ready).toBe(false);
    expect(card.readyLabel).toBe('0/1');
    expect(card.imageTag).toBe('1.2.3');
    expect(card.selected).toBe(true);
    expect(vm.toolbar.counters.find((counter) => counter.id === 'failed')!.tone).toBe('critical');
  });
});

describe('container grid view model — rollups, filters and inspector', () => {
  it('builds phase and namespace chips with counts', () => {
    const { vm } = scene();
    expect(vm.filters.phases[0]).toMatchObject({ phase: 'all', count: 24, active: true });
    expect(vm.filters.phases.find((chip) => chip.phase === 'failed')!.count).toBeGreaterThan(0);
    expect(vm.filters.namespaces.length).toBeGreaterThan(1);
    expect(vm.filters.namespaces[0]!.count).toBeGreaterThan(0);
  });

  it('applies filters and reports the active filter count', () => {
    const { vm } = scene({ filters: { ...emptyContainerFilter, phases: ['failed'], query: 'api' } });
    expect(vm.filters.activeCount).toBe(2);
    expect(vm.filters.phases.find((chip) => chip.phase === 'failed')!.active).toBe(true);
    expect(vm.cards.filteredTotal).toBeLessThan(24);
    for (const card of vm.cards.items) expect(card.phase).toBe('failed');
  });

  it('rolls up capacity with the top consumers', () => {
    const { vm } = scene();
    expect(vm.capacity.map((metric) => metric.id)).toEqual(['cpu', 'memory']);
    const cpu = vm.capacity[0]!;
    expect(cpu.percent).toBeGreaterThan(0);
    expect(cpu.usedLabel).toMatch(/cores/);
    expect(cpu.limitLabel).toMatch(/cores/);
    expect(cpu.consumers).toHaveLength(5); // top five; the panel renders the first three
    expect(cpu.consumers[0]!.percent).toBeGreaterThanOrEqual(cpu.consumers[1]!.percent);
    expect(vm.namespaces.length).toBeGreaterThan(1);
    expect(vm.namespaces[0]!.percent).toBeCloseTo(100, 5);
  });

  it('builds the inspector rows for the selected container', () => {
    const { store, vm } = scene({ selectionId: null });
    const first = store.all()[0]!;
    const selected = buildContainerGridViewModel({
      store,
      theme,
      t,
      filters: { ...emptyContainerFilter },
      selectionId: first.id,
      scrollTop: 0,
      first: 0,
      count: 5,
      columns: 3,
      cardWidth: 300,
      connectionState: 'live',
    });
    expect(vm.detail.container).toBeNull();
    expect(selected.detail.container?.id).toBe(first.id);
    const labels = selected.detail.rows.map((row) => row.label);
    expect(labels).toContain('phase');
    expect(labels).toContain('restarts');
    expect(labels).toContain('image');
    expect(selected.detail.labels.length).toBeGreaterThan(0);
    expect(selected.detail.spark.length).toBeGreaterThan(0);
  });

  it('marks narrow cards as compact', () => {
    expect(scene({ cardWidth: 200 }).vm.cards.items[0]!.compact).toBe(true);
    expect(scene({ cardWidth: 320 }).vm.cards.items[0]!.compact).toBe(false);
  });

  it('supports every sort order', () => {
    const store = new ContainerStore();
    store.update(createMockContainerSnapshot({ elapsedSeconds: 7, size: 12 }));
    const all = store.filtered({ ...emptyContainerFilter });
    expect(sortContainers(all, 'restarts')[0]!.spec.restarts).toBeGreaterThanOrEqual(
      sortContainers(all, 'restarts')[1]!.spec.restarts,
    );
    expect(sortContainers(all, 'cpu')[0]!.cpu.used).toBeGreaterThanOrEqual(sortContainers(all, 'cpu')[1]!.cpu.used);
    expect(sortContainers(all, 'memory')[0]!.memory.used).toBeGreaterThanOrEqual(
      sortContainers(all, 'memory')[1]!.memory.used,
    );
    const byName = sortContainers(all, 'name').map((entry) => entry.name);
    expect([...byName].sort((a, b) => a.localeCompare(b))).toEqual(byName);
    // Default ordering puts the most severe workload first.
    expect(sortContainers(all, 'severity')[0]!.health).toBe('critical');
  });

  it('translates into other locales and honours hidden sections', () => {
    const fa = createTranslator('fa');
    const { store } = scene();
    const vm = buildContainerGridViewModel({
      store,
      theme,
      t: fa,
      filters: { ...emptyContainerFilter },
      selectionId: null,
      scrollTop: 0,
      first: 0,
      count: 3,
      columns: 3,
      cardWidth: 260,
      hiddenSections: { namespaces: false },
    });
    expect(vm.toolbar.title).toBe('ناوگان کانتینر');
    expect(vm.hidden.has('namespaces')).toBe(true);
  });
});

