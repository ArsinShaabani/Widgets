import { describe, expect, it } from 'vitest';
import { computeTimelineGeometry, computeTimelineLayout, computeTimelineWindow, maxTimelineScroll, TIMELINE_SECTIONS } from '../src/index';

describe('computeTimelineLayout', () => {
  it('puts a full-width toolbar and filter strip above the content', () => {
    const layout = computeTimelineLayout({ width: 1480, height: 900 });
    expect(layout.columns).toBe(2);
    expect(layout.toolbar.width).toBe(layout.sections.filters!.width);
    expect(layout.sections.filters!.y).toBeGreaterThan(layout.toolbar.y + layout.toolbar.height - 1);
  });

  it('keeps the heatmap in the left column and the rollups on the right', () => {
    const layout = computeTimelineLayout({ width: 1480, height: 900 });
    const timeline = layout.sections.timeline!;
    const slo = layout.sections.slo!;
    expect(timeline.x).toBeLessThan(slo.x);
    expect(timeline.width).toBeGreaterThan(slo.width);
    expect(layout.sections.incidents!.width).toBe(slo.width);
    expect(layout.sections.detail!.width).toBe(slo.width);
  });

  it('collapses to one column below the breakpoint', () => {
    const layout = computeTimelineLayout({ width: 820, height: 1000 });
    expect(layout.columns).toBe(1);
    const xs = new Set(Object.values(layout.sections).map((rect) => rect?.x));
    expect(xs.size).toBe(1);
  });

  it('never overlaps sections and stays inside the bounds', () => {
    const layout = computeTimelineLayout({ width: 1280, height: 800 });
    const right = ['slo', 'incidents', 'detail'] as const;
    const rects = right
      .map((id) => layout.sections[id])
      .filter((rect): rect is NonNullable<typeof rect> => Boolean(rect));
    for (let index = 1; index < rects.length; index += 1) {
      expect(rects[index]!.y).toBeGreaterThanOrEqual(rects[index - 1]!.y + rects[index - 1]!.height);
    }
    for (const rect of Object.values(layout.sections)) {
      if (!rect) continue;
      expect(rect.x + rect.width).toBeLessThanOrEqual(1281);
      expect(rect.y + rect.height).toBeLessThanOrEqual(801);
    }
  });

  it('drops the lowest priority sections when the height is tiny', () => {
    const layout = computeTimelineLayout({ width: 1280, height: 300 });
    expect(layout.dropped).toContain('detail');
    expect(layout.sections.timeline).toBeDefined();
  });

  it('honours hidden sections and forced columns', () => {
    const layout = computeTimelineLayout({ width: 1480, height: 900, hidden: ['incidents', 'detail'] });
    expect(layout.sections.incidents).toBeUndefined();
    expect(layout.order).not.toContain('detail');
    expect(computeTimelineLayout({ width: 1480, height: 900, columns: 1 }).columns).toBe(1);
    expect(TIMELINE_SECTIONS).toHaveLength(6);
  });
});

describe('computeTimelineGeometry', () => {
  it('fits 90 day cells inside the available width', () => {
    const rect = { x: 0, y: 0, width: 900, height: 400 };
    const geometry = computeTimelineGeometry(rect, 90, 30, 11);
    const used = geometry.labelWidth + geometry.days * (geometry.cellWidth + geometry.cellGap);
    expect(used).toBeLessThanOrEqual(rect.width + geometry.cellGap);
    expect(geometry.cellWidth).toBeGreaterThan(2);
    expect(geometry.rowStride).toBe(30);
    expect(geometry.visibleRows).toBeGreaterThan(10);
  });

  it('shrinks the cells on narrow viewports and shortens the label column', () => {
    const wide = computeTimelineGeometry({ x: 0, y: 0, width: 1000, height: 400 }, 90, 30, 11);
    const narrow = computeTimelineGeometry({ x: 0, y: 0, width: 420, height: 400 }, 90, 30, 11);
    expect(narrow.cellWidth).toBeLessThan(wide.cellWidth);
    expect(narrow.labelWidth).toBeLessThan(wide.labelWidth);
    expect(narrow.cellGap).toBeLessThanOrEqual(wide.cellGap);
  });
});

describe('computeTimelineWindow', () => {
  const geometry = computeTimelineGeometry({ x: 0, y: 0, width: 900, height: 300 }, 90, 30, 11);

  it('renders only the rows in view plus overscan', () => {
    const window = computeTimelineWindow(geometry, 40, 0, 2);
    expect(window.first).toBe(0);
    expect(window.count).toBe(geometry.visibleRows + 4); // +2 rows of overscan above and below
    expect(window.topPad).toBe(0);
    expect(window.bottomPad).toBeGreaterThan(0);
  });

  it('follows the scroll offset symmetrically', () => {
    const scrolled = computeTimelineWindow(geometry, 40, geometry.rowStride * 5, 2);
    expect(scrolled.firstRow).toBe(3);
    expect(scrolled.topPad).toBe(3 * geometry.rowStride);
    expect(scrolled.first).toBe(3);
  });

  it('clamps an out-of-range offset to the end of the fleet', () => {
    const window = computeTimelineWindow(geometry, 6, 100_000, 2);
    expect(window.firstRow).toBe(0);
    expect(window.count).toBe(6);
    expect(window.bottomPad).toBe(0);
  });

  it('reports zero rows for an empty fleet', () => {
    const window = computeTimelineWindow(geometry, 0, 0, 2);
    expect(window.count).toBe(0);
    expect(window.totalRows).toBe(0);
  });
});

describe('maxTimelineScroll', () => {
  const geometry = computeTimelineGeometry({ x: 0, y: 0, width: 900, height: 300 }, 90, 30, 11);

  it('is zero when everything fits and grows otherwise', () => {
    expect(maxTimelineScroll(3, geometry, 300)).toBe(0);
    expect(maxTimelineScroll(30, geometry, 300)).toBeGreaterThan(0);
  });
});
