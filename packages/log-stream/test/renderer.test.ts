import { describe, expect, it } from 'vitest';
import { LogStore, createTranslator, emptyLogFilter, resolveTheme, type LogEntry } from '@widgets/core';
import { createFakeContext } from '@widgets/render/testing';
import { buildLogViewModel, computeLogLayout, renderLogWidget, type LogSectionId } from '../src/index';

const theme = resolveTheme('dark');
const t = createTranslator('en');

const entry = (message: string, level: LogEntry['level'] = 'info', service = 'api', at = Date.now()): LogEntry => ({
  id: `${message}-${at}`,
  timestamp: at,
  level,
  service,
  message,
});

function scene(options: {
  width?: number;
  height?: number;
  lines?: number;
  filters?: typeof emptyLogFilter;
  hiddenIds?: LogSectionId[];
  selectionId?: string | null;
  hoverId?: string;
  hidden?: Record<string, boolean>;
} = {}) {
  const { width = 1280, height = 820, lines = 400 } = options;
  const store = new LogStore({ collapseRepeats: false, maxEntries: lines + 100 });
  store.append(
    Array.from({ length: lines }, (_, i) =>
      entry(`request ${i} completed in ${i % 400}ms`, i % 17 === 0 ? 'error' : i % 5 === 0 ? 'warn' : 'info', i % 3 === 0 ? 'api-gateway' : 'worker'),
    ),
  );

  const hiddenList = options.hidden
    ? Object.entries(options.hidden)
        .filter(([, enabled]) => enabled === false)
        .map(([id]) => id as LogSectionId)
    : undefined;
  const layout = computeLogLayout({
    width,
    height,
    ...(hiddenList && hiddenList.length > 0 ? { hidden: hiddenList } : {}),
  });
  const streamRect = layout.sections.stream!;
  const vm = buildLogViewModel({
    store,
    theme,
    t,
    filters: options.filters ?? { ...emptyLogFilter },
    selectionId: options.selectionId ?? null,
    scrollTop: 0,
    follow: true,
    rowHeight: 26,
    first: 0,
    count: Math.ceil((streamRect.height - 34) / 26),
    connectionState: 'live',
    ...(options.hidden ? { hiddenSections: options.hidden } : {}),
  });

  const ctx = createFakeContext();
  const result = renderLogWidget(ctx, {
    theme,
    layout,
    vm,
    ...(options.hoverId ? { hoverId: options.hoverId } : {}),
  });
  return { ctx, layout, vm, result, store };
}

describe('renderLogWidget', () => {
  it('paints every section and reports the interactive regions', () => {
    const { ctx, result } = scene();
    expect(ctx.calls.fill).toBeGreaterThan(10);
    expect(ctx.calls.fillText).toBeGreaterThan(20);

    const ids = result.regions.map((region) => region.id);
    expect(ids).toContain('action-follow');
    expect(ids).toContain('filter-level-all');
    expect(ids).toContain('filter-level-error');
    expect(ids.some((id) => id.startsWith('row-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('bucket-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('service-'))).toBe(true);
    expect(ids).toContain('counter-received');
  });

  it('virtualises the list: only viewport rows are painted', () => {
    const { vm, result } = scene({ lines: 5000 });
    const rowRegions = result.regions.filter((region) => region.id.startsWith('row-'));
    expect(rowRegions.length).toBe(vm.stream.windowSize);
    expect(rowRegions.length).toBeLessThan(40);
    expect(vm.stream.filteredTotal).toBe(5000);
  });

  it('writes log copy into the canvas', () => {
    const { ctx } = scene({ lines: 20 });
    const text = ctx.texts.join(' | ');
    expect(text).toContain('Live log stream');
    expect(text).toContain('MESSAGE');
    expect(text).toContain('api-gateway');
    expect(text).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
  });

  it('skips hidden sections', () => {
    const { result } = scene({ hidden: { histogram: false, services: false } });
    const ids = result.regions.map((region) => region.id);
    expect(ids.some((id) => id.startsWith('bucket-'))).toBe(false);
    expect(ids.some((id) => id.startsWith('service-'))).toBe(false);
  });

  it('renders the pending state without any data', () => {
    const store = new LogStore();
    const layout = computeLogLayout({ width: 1000, height: 700 });
    const vm = buildLogViewModel({
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
      connectionState: 'connecting',
    });
    const ctx = createFakeContext();
    const result = renderLogWidget(ctx, { theme, layout, vm });
    expect(result.regions.some((region) => region.id.startsWith('row-'))).toBe(false);
    expect(ctx.texts.join(' | ')).toContain('Connecting');
  });

  it('renders the single column layout on narrow viewports', () => {
    const { layout, result } = scene({ width: 480, height: 900 });
    expect(layout.columns).toBe(1);
    expect(result.regions.some((region) => region.id.startsWith('row-'))).toBe(true);
  });

  it('draws hover highlight and tooltip without throwing', () => {
    const { ctx, result } = scene({ lines: 30, hoverId: 'filter-level-error' });
    expect(result.regions.length).toBeGreaterThan(0);
    expect(ctx.calls.setLineDash).toBeGreaterThan(0);
  });

  it('keeps the selection visible with a highlighted row', () => {
    const store = new LogStore({ collapseRepeats: false });
    store.append([entry('only line')]);
    const layout = computeLogLayout({ width: 1100, height: 700 });
    const selected = store.entries()[0]!.id;
    const vm = buildLogViewModel({
      store,
      theme,
      t,
      filters: { ...emptyLogFilter },
      selectionId: selected,
      scrollTop: 0,
      follow: true,
      rowHeight: 26,
      first: 0,
      count: 5,
      connectionState: 'live',
    });
    const ctx = createFakeContext();
    renderLogWidget(ctx, { theme, layout, vm });
    expect(vm.stream.rows[0]!.selected).toBe(true);
    // Selected rows paint an extra background rounded rect.
    expect(ctx.calls.roundRect ?? ctx.calls.fill).toBeGreaterThan(0);
  });
});
