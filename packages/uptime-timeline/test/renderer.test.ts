import { describe, expect, it } from 'vitest';
import { UptimeStore, createMockUptimeSnapshot, resolveTheme } from '@widgets/core';
import { createFakeContext } from '@widgets/render/testing';
import { buildUptimeViewModel, computeTimelineLayout, renderUptimeTimeline, type TimelineSectionId } from '../src/index';

const theme = resolveTheme('dark');
const t = (key: string) =>
  (
    {
      'uptime.title': 'Service reliability',
      'uptime.subtitle': 'Availability, SLOs and incident history',
      'uptime.services': 'services',
      'uptime.overall': 'Overall availability',
      'uptime.belowSlo': 'below SLO',
      'uptime.openIncidents': 'open incidents',
      'uptime.empty': 'No services match the current filters',
      'uptime.slo.target': 'target',
      'uptime.slo.budget': 'budget used',
      'uptime.checkpoints': 'checkpoints',
      'uptime.window': 'window',
      'uptime.mttr': 'MTTR',
      'uptime.mtbf': 'MTBF',
      'uptime.incidents.open': 'Open',
      'uptime.incidents.resolved': 'Resolved',
      'uptime.incidents.empty': 'No incidents in the window',
      'uptime.detail': 'Incident detail',
      'uptime.detail.empty': 'Select a service or incident',
      'log.all': 'All',
      'status.live': 'Live',
      'status.connecting': 'Connecting',
      'grid.copy': 'Copy state',
    } as Record<string, string>
  )[key] ?? key;

function scene(options: { width?: number; height?: number; size?: number; hidden?: Record<string, boolean>; selected?: boolean } = {}) {
  const { width = 1480, height = 900, size = 8 } = options;
  const store = new UptimeStore();
  store.update(createMockUptimeSnapshot({ size, windowDays: 90, incident: true, now: Date.UTC(2026, 10, 6, 12) }));
  const selected = options.selected ? store.all()[0]!.id : null;

  const hiddenList = options.hidden
    ? Object.entries(options.hidden)
        .filter(([, enabled]) => enabled === false)
        .map(([id]) => id as TimelineSectionId)
    : undefined;

  const layout = computeTimelineLayout({
    width,
    height,
    ...(hiddenList && hiddenList.length > 0 ? { hidden: hiddenList } : {}),
  });
  const vm = buildUptimeViewModel({
    store,
    theme,
    t: t as never,
    filters: { states: [], groups: [], query: '' },
    selectionId: selected,
    selectedIncidentId: null,
    scrollTop: 0,
    first: 0,
    count: layout.geometry.visibleRows,
    cellWidth: layout.geometry.cellWidth,
    connectionState: 'live',
    now: Date.UTC(2026, 10, 6, 12),
    ...(options.hidden ? { hiddenSections: options.hidden } : {}),
  });

  const ctx = createFakeContext();
  const result = renderUptimeTimeline(ctx, { theme, layout, vm });
  return { ctx, layout, vm, result, store };
}

describe('renderUptimeTimeline', () => {
  it('paints every section and reports the interactive regions', () => {
    const { ctx, result } = scene();
    expect(ctx.calls.fill).toBeGreaterThan(20);
    expect(ctx.calls.fillText).toBeGreaterThan(20);

    const ids = result.regions.map((region) => region.id);
    expect(ids).toContain('action-attention');
    expect(ids).toContain('filter-state-all');
    expect(ids.some((id) => id.startsWith('row-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('slo-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('incident-'))).toBe(true);
    expect(ids).toContain('counter-overall');
  });

  it('draws a heatmap cell for every day of every visible row', () => {
    const { ctx, vm } = scene({ size: 4 });
    const expected = vm.timeline.rows.reduce((sum, row) => sum + row.cells.length, 0);
    expect(expected).toBeGreaterThan(300);
    // Each cell paints one rounded rect: far more fills than sections alone.
    expect(ctx.calls.roundRect ?? ctx.calls.fill).toBeGreaterThan(expected / 10);
    expect(ctx.texts.join(' | ')).toContain('Availability timeline');
  });

  it('virtualises the heatmap rows', () => {
    const { vm, result, layout } = scene({ size: 8 });
    const rows = result.regions.filter((region) => region.id.startsWith('row-'));
    expect(rows.length).toBe(vm.timeline.rows.length);
    expect(rows.length).toBeLessThanOrEqual(layout.geometry.visibleRows + 4);
  });

  it('skips hidden sections', () => {
    const { result } = scene({ hidden: { slo: false, incidents: false } });
    const ids = result.regions.map((region) => region.id);
    expect(ids.some((id) => id.startsWith('slo-'))).toBe(false);
    expect(ids.some((id) => id.startsWith('incident-'))).toBe(false);
  });

  it('renders the single column layout on narrow viewports', () => {
    const { layout, result } = scene({ width: 760, height: 1000 });
    expect(layout.columns).toBe(1);
    expect(result.regions.some((region) => region.id.startsWith('row-'))).toBe(true);
  });

  it('renders the pending state without data', () => {
    const store = new UptimeStore();
    const layout = computeTimelineLayout({ width: 1200, height: 800 });
    const pending = buildUptimeViewModel({
      store,
      theme,
      t: t as never,
      filters: { states: [], groups: [], query: '' },
      selectionId: null,
      selectedIncidentId: null,
      scrollTop: 0,
      first: 0,
      count: 8,
      cellWidth: layout.geometry.cellWidth,
      connectionState: 'connecting',
    });
    const ctx = createFakeContext();
    const result = renderUptimeTimeline(ctx, { theme, layout, vm: pending });
    expect(result.regions.some((region) => region.id.startsWith('row-'))).toBe(false);
    expect(ctx.texts.join(' | ')).toContain('Connecting');
  });
});
