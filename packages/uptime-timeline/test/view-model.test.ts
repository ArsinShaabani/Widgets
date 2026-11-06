import { describe, expect, it } from 'vitest';
import { UptimeStore, createMockUptimeSnapshot, createTranslator, emptyUptimeFilter, resolveTheme } from '@widgets/core';
import { buildUptimeViewModel, monthLabels } from '../src/index';

const theme = resolveTheme('dark');
const t = createTranslator('en');
const NOW = Date.UTC(2026, 10, 6, 12);

function scene(options: { size?: number; windowDays?: number; incident?: boolean } = {}) {
  const store = new UptimeStore({ windowDays: options.windowDays ?? 90 });
  store.update(
    createMockUptimeSnapshot({
      size: options.size ?? 8,
      windowDays: options.windowDays ?? 90,
      incident: options.incident ?? true,
      now: NOW,
    }),
  );
  return store;
}

function view(store: UptimeStore, overrides: Partial<Parameters<typeof buildUptimeViewModel>[0]> = {}) {
  return buildUptimeViewModel({
    store,
    theme,
    t,
    filters: { ...emptyUptimeFilter },
    selectionId: null,
    selectedIncidentId: null,
    scrollTop: 0,
    first: 0,
    count: 8,
    cellWidth: 10,
    connectionState: 'live',
    now: NOW,
    ...overrides,
  });
}

describe('uptime view model', () => {
  it('renders a pending state before the first snapshot', () => {
    const vm = view(new UptimeStore(), { connectionState: 'connecting' });
    expect(vm.timeline.pending).toBe(true);
    expect(vm.timeline.rows).toEqual([]);
    expect(vm.toolbar.connection.label).toBe('Connecting');
  });

  it('materialises the requested window of heatmap rows', () => {
    const vm = view(scene(), { first: 2, count: 3 });
    expect(vm.timeline.rows).toHaveLength(3);
    expect(vm.timeline.rows[0]!.index).toBe(2);
    expect(vm.timeline.filteredTotal).toBe(8);
    expect(vm.timeline.days).toBe(90);
    expect(vm.timeline.rows[0]!.cells).toHaveLength(90);
    expect(vm.timeline.rows[0]!.cells[0]!.color).toBeTruthy();
    expect(vm.timeline.monthLabels.length).toBeGreaterThan(0);
  });

  it('reports availability, SLO breaches and error budget', () => {
    const vm = view(scene());
    const outage = vm.timeline.rows.find((row) => row.state === 'major_outage')!;
    expect(outage).toBeDefined();
    expect(outage.breached).toBe(true);
    expect(outage.errorBudgetUsed).toBeGreaterThan(0);
    expect(outage.statusColor).toBe(theme.status.critical);

    const counters = Object.fromEntries(vm.toolbar.counters.map((counter) => [counter.id, counter]));
    expect(counters.services!.value).toBe('8');
    expect(counters.incidents!.tone).toBe('critical');
    expect(vm.toolbar.summary.map((entry) => entry.label)).toEqual(['MTTR', 'MTBF', 'window']);
  });

  it('builds the SLO panel worst-first', () => {
    const vm = view(scene());
    expect(vm.slo.length).toBeGreaterThan(1);
    expect(vm.slo[0]!.uptimePercent).toBeLessThanOrEqual(vm.slo[1]!.uptimePercent);
    expect(vm.slo[0]!.tone).toBe('critical');
    expect(vm.slo[0]!.budgetLabel).toMatch(/%/);
  });

  it('lists open incidents first and exposes their update trail', () => {
    const store = scene({ incident: true });
    const openIncident = store.allIncidents().find((incident) => incident.state !== 'resolved')!;
    const vm = view(store, { selectedIncidentId: openIncident.id });

    expect(vm.incidents.openCount).toBeGreaterThan(0);
    expect(vm.incidents.rows[0]!.open).toBe(true);
    expect(vm.detail.kind).toBe('incident');
    expect(vm.detail.updates.length).toBeGreaterThan(1);
    expect(vm.detail.rows.map((row) => row.label)).toContain('duration');
  });
});

describe('uptime view model — filters and inspector', () => {
  it('filters by state, group and attention', () => {
    const store = scene();
    const major = store.all().find((service) => service.state === 'major_outage')!;

    const filtered = view(store, { filters: { ...emptyUptimeFilter, states: ['major_outage'], attentionOnly: true } });
    expect(filtered.filters.activeCount).toBe(2);
    expect(filtered.timeline.filteredTotal).toBeLessThanOrEqual(1);
    expect(filtered.filters.states.find((chip) => chip.state === 'major_outage')!.active).toBe(true);

    const byGroup = view(store, { filters: { ...emptyUptimeFilter, groups: [major.group!] } });
    expect(byGroup.filters.groups.some((chip) => chip.group === major.group)).toBe(true);
    expect(byGroup.timeline.filteredTotal).toBeGreaterThan(0);
  });

  it('selects a service and exposes its inspector', () => {
    const store = scene();
    const first = store.all()[0]!;
    const vm = view(store, { selectionId: first.id });
    expect(vm.detail.kind).toBe('service');
    expect(vm.detail.title).toBe(first.name);
    expect(vm.detail.cells.length).toBeGreaterThan(10);
    expect(vm.detail.rows.map((row) => row.label)).toContain('uptime');
    expect(vm.timeline.rows.some((row) => row.selected)).toBe(true);
  });

  it('translates into other locales', () => {
    const vm = view(scene(), { t: createTranslator('fa'), count: 4 });
    expect(vm.toolbar.title).toBe('پایداری سرویس');
    expect(vm.timeline.emptyLabel).toBe('با این فیلترها سرویسی پیدا نشد');
  });

  it('formats month markers for the axis', () => {
    const days = [Date.UTC(2026, 7, 1), Date.UTC(2026, 7, 20), Date.UTC(2026, 8, 2)];
    const labels = monthLabels(days, days[0]!);
    expect(labels.map((entry) => entry.label)).toEqual(['Aug', 'Sep']);
    expect(labels[0]!.index).toBe(0);
    expect(labels[1]!.index).toBe(2);
  });

  it('marks short rows as compact', () => {
    const store = scene();
    expect(view(store, { rowHeight: 20 }).timeline.rows[0]!.compact).toBe(true);
    expect(view(store, { rowHeight: 30 }).timeline.rows[0]!.compact).toBe(false);
  });
});
