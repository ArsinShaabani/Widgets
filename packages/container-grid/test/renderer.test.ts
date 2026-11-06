import { describe, expect, it } from 'vitest';
import { ContainerStore, createMockContainerSnapshot, createTranslator, emptyContainerFilter, resolveTheme } from '@widgets/core';
import { createFakeContext } from '@widgets/render/testing';
import { buildContainerGridViewModel, computeGridLayout, renderContainerGrid, type GridSectionId } from '../src/index';

const theme = resolveTheme('dark');
const t = createTranslator('en');

function scene(options: { width?: number; height?: number; size?: number; hidden?: Record<string, boolean>; selection?: boolean; hover?: string } = {}) {
  const { width = 1400, height = 900, size = 24 } = options;
  const store = new ContainerStore();
  // Two snapshots so the card/detail sparklines have real history to draw.
  store.update(createMockContainerSnapshot({ elapsedSeconds: 88, size, incident: true }));
  store.update(createMockContainerSnapshot({ elapsedSeconds: 90, size, incident: true }));
  const selected = options.selection ? store.all()[0]!.id : null;

  const hiddenList = options.hidden
    ? Object.entries(options.hidden)
        .filter(([, enabled]) => enabled === false)
        .map(([id]) => id as GridSectionId)
    : undefined;

  const layout = computeGridLayout({
    width,
    height,
    ...(hiddenList && hiddenList.length > 0 ? { hidden: hiddenList } : {}),
  });
  const gridRect = layout.sections.grid!;
  const vm = buildContainerGridViewModel({
    store,
    theme,
    t,
    filters: { ...emptyContainerFilter },
    selectionId: selected,
    scrollTop: 0,
    first: 0,
    count: layout.grid.visibleRows * layout.grid.columns,
    columns: layout.grid.columns,
    cardWidth: layout.grid.cardWidth,
    connectionState: 'live',
    ...(options.hidden ? { hiddenSections: options.hidden } : {}),
  });

  const ctx = createFakeContext();
  const result = renderContainerGrid(ctx, {
    theme,
    layout,
    vm,
    cardHeight: 132,
    cardGap: 12,
    ...(options.hover ? { hoverId: options.hover } : {}),
  });
  void gridRect;
  return { ctx, layout, vm, result, store };
}

describe('renderContainerGrid', () => {
  it('paints every section and reports the interactive regions', () => {
    const { ctx, result } = scene();
    expect(ctx.calls.fill).toBeGreaterThan(20);
    expect(ctx.calls.fillText).toBeGreaterThan(30);

    const ids = result.regions.map((region) => region.id);
    expect(ids).toContain('action-attention');
    expect(ids).toContain('filter-phase-all');
    expect(ids).toContain('filter-phase-failed');
    expect(ids.some((id) => id.startsWith('card-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('namespace-'))).toBe(true);
    expect(ids).toContain('counter-total');
    expect(ids).toContain('capacity');
  });

  it('virtualises the grid: only rows in view are painted', () => {
    const { vm, result, layout } = scene({ size: 400 });
    const cards = result.regions.filter((region) => region.id.startsWith('card-'));
    expect(cards.length).toBe(vm.cards.items.length);
    expect(cards.length).toBeLessThanOrEqual((layout.grid.visibleRows + 2) * layout.grid.columns);
    expect(vm.cards.filteredTotal).toBe(400);
  });

  it('writes fleet copy into the canvas', () => {
    const { ctx } = scene({ size: 12 });
    const text = ctx.texts.join(' | ');
    expect(text).toContain('Container fleet');
    expect(text).toContain('Capacity');
    expect(text).toContain('Namespaces');
    expect(text).toMatch(/Running|Failed|Pending|Succeeded/);
    expect(text).toMatch(/cores/);
  });

  it('renders the inspector for the selected workload', () => {
    const { ctx, vm } = scene({ size: 8, selection: true });
    expect(vm.detail.container).not.toBeNull();
    expect(ctx.texts.join(' | ')).toContain('CPU history');
  });

  it('skips hidden sections', () => {
    const { result } = scene({ hidden: { namespaces: false, capacity: false } });
    const ids = result.regions.map((region) => region.id);
    expect(ids.some((id) => id.startsWith('namespace-'))).toBe(false);
    expect(ids).not.toContain('capacity');
  });

  it('renders the pending state without data and the empty state with filters', () => {
    const store = new ContainerStore();
    const layout = computeGridLayout({ width: 1200, height: 700 });
    const pending = buildContainerGridViewModel({
      store,
      theme,
      t,
      filters: { ...emptyContainerFilter },
      selectionId: null,
      scrollTop: 0,
      first: 0,
      count: 6,
      columns: layout.grid.columns,
      cardWidth: layout.grid.cardWidth,
      connectionState: 'connecting',
    });
    const ctx = createFakeContext();
    const result = renderContainerGrid(ctx, { theme, layout, vm: pending, cardHeight: 132, cardGap: 12 });
    expect(result.regions.some((region) => region.id.startsWith('card-'))).toBe(false);
    expect(ctx.texts.join(' | ')).toContain('Connecting');

    store.update(createMockContainerSnapshot({ elapsedSeconds: 3, size: 6 }));
    const empty = buildContainerGridViewModel({
      store,
      theme,
      t,
      filters: { ...emptyContainerFilter, query: 'does-not-exist' },
      selectionId: null,
      scrollTop: 0,
      first: 0,
      count: 6,
      columns: layout.grid.columns,
      cardWidth: layout.grid.cardWidth,
    });
    const emptyCtx = createFakeContext();
    renderContainerGrid(emptyCtx, { theme, layout, vm: empty, cardHeight: 132, cardGap: 12 });
    expect(emptyCtx.texts.join(' | ')).toContain('No workloads match');
  });

  it('renders the single column layout on narrow viewports', () => {
    const { layout, result } = scene({ width: 700, height: 900 });
    expect(layout.columns).toBe(1);
    expect(result.regions.some((region) => region.id.startsWith('card-'))).toBe(true);
  });

  it('draws hover highlight and tooltips without throwing', () => {
    const { ctx, result } = scene({ size: 6, hover: 'filter-phase-failed' });
    expect(result.regions.length).toBeGreaterThan(4);
    expect(ctx.calls.setLineDash).toBeGreaterThan(0);
  });
});
