import { describe, expect, it } from 'vitest';
import { GRID_SECTIONS, computeGridGeometry, computeGridLayout, computeGridWindow, maxGridScroll } from '../src/index';

describe('computeGridLayout', () => {
  it('puts a full-width toolbar and filter strip above the content', () => {
    const layout = computeGridLayout({ width: 1440, height: 900 });
    expect(layout.columns).toBe(2);
    expect(layout.toolbar.width).toBeGreaterThan(1000);
    const filters = layout.sections.filters!;
    expect(filters.y).toBeGreaterThanOrEqual(layout.toolbar.y + layout.toolbar.height);
    expect(filters.width).toBe(layout.toolbar.width);
  });

  it('keeps the grid in the left column and the rollups on the right', () => {
    const layout = computeGridLayout({ width: 1440, height: 900 });
    const grid = layout.sections.grid!;
    const capacity = layout.sections.capacity!;
    expect(grid.x).toBeLessThan(capacity.x);
    expect(grid.width).toBeGreaterThan(capacity.width);
    // Right column widths are equal, so the rollups form a clean stack.
    expect(layout.sections.namespaces!.width).toBe(capacity.width);
    expect(layout.sections.detail!.width).toBe(capacity.width);
  });

  it('collapses to one column below the breakpoint', () => {
    const layout = computeGridLayout({ width: 720, height: 900 });
    expect(layout.columns).toBe(1);
    const xs = new Set(Object.values(layout.sections).map((rect) => rect?.x));
    expect(xs.size).toBe(1);
    expect(layout.order.indexOf('grid')).toBeLessThan(layout.order.indexOf('capacity'));
  });

  it('never overlaps sections inside a column and stays in bounds', () => {
    const layout = computeGridLayout({ width: 1280, height: 820 });
    const right = ['capacity', 'namespaces', 'detail'] as const;
    const rects = right
      .map((id) => layout.sections[id])
      .filter((rect): rect is NonNullable<typeof rect> => Boolean(rect));
    for (let index = 1; index < rects.length; index += 1) {
      expect(rects[index]!.y).toBeGreaterThanOrEqual(rects[index - 1]!.y + rects[index - 1]!.height);
    }
    for (const rect of Object.values(layout.sections)) {
      if (!rect) continue;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(1281);
      expect(rect.y + rect.height).toBeLessThanOrEqual(821);
    }
  });

  it('drops the lowest priority sections when the height is tiny', () => {
    const layout = computeGridLayout({ width: 1280, height: 300 });
    expect(layout.dropped).toContain('namespaces');
    expect(layout.sections.grid).toBeDefined();
  });

  it('honours hidden sections and forced columns', () => {
    const layout = computeGridLayout({ width: 1440, height: 900, hidden: ['namespaces', 'detail'] });
    expect(layout.sections.namespaces).toBeUndefined();
    expect(layout.sections.detail).toBeUndefined();
    expect(layout.order).not.toContain('detail');
    expect(computeGridLayout({ width: 1440, height: 900, columns: 1 }).columns).toBe(1);
    expect(GRID_SECTIONS).toHaveLength(6);
  });
});

describe('computeGridGeometry', () => {
  const rect = { x: 0, y: 0, width: 900, height: 500 };

  it('fits as many cards as the width allows', () => {
    const geometry = computeGridGeometry(rect, 240, 130, 12);
    expect(geometry.columns).toBe(3);
    expect(geometry.cardWidth).toBeCloseTo((900 - 24) / 3, 5);
    expect(geometry.rowStride).toBe(142);
    expect(geometry.visibleRows).toBeGreaterThan(2);
  });

  it('never returns zero columns, even on a tiny viewport', () => {
    const geometry = computeGridGeometry({ x: 0, y: 0, width: 60, height: 40 }, 300, 130, 12);
    expect(geometry.columns).toBe(1);
    expect(geometry.cardWidth).toBeGreaterThanOrEqual(80);
    expect(geometry.visibleRows).toBeGreaterThanOrEqual(1);
  });
});

describe('computeGridWindow', () => {
  const geometry = computeGridGeometry({ x: 0, y: 0, width: 900, height: 300 }, 240, 130, 12);

  it('renders only the rows in view (plus overscan)', () => {
    const window = computeGridWindow(geometry, 400, 0, 1);
    const expectedRows = geometry.visibleRows + 2;
    expect(window.first).toBe(0);
    expect(window.count).toBe(expectedRows * geometry.columns);
    expect(window.topPad).toBe(0);
    expect(window.bottomPad).toBeGreaterThan(0);
  });

  it('follows the scroll offset', () => {
    const scrolled = computeGridWindow(geometry, 400, geometry.rowStride * 3, 1);
    expect(scrolled.firstRow).toBe(2); // 3 - overscan
    expect(scrolled.topPad).toBe(2 * geometry.rowStride);
    expect(scrolled.first).toBe(2 * geometry.columns);
  });

  it('clamps an out-of-range offset to the end of the fleet', () => {
    const window = computeGridWindow(geometry, 12, 100_000, 1);
    const totalRows = Math.ceil(12 / geometry.columns);
    expect(window.firstRow).toBeLessThanOrEqual(Math.max(0, totalRows - (geometry.visibleRows + 2)));
    expect(window.bottomPad).toBe(0);
    expect(window.first + window.count).toBeLessThanOrEqual(12);
  });

  it('reports zero cards for an empty fleet', () => {
    const window = computeGridWindow(geometry, 0, 0, 1);
    expect(window.count).toBe(0);
    expect(window.totalRows).toBe(0);
  });
});

describe('maxGridScroll', () => {
  const geometry = computeGridGeometry({ x: 0, y: 0, width: 900, height: 300 }, 240, 130, 12);

  it('is zero when everything fits and grows with the fleet', () => {
    expect(maxGridScroll(3, geometry, 400)).toBe(0);
    expect(maxGridScroll(90, geometry, 300)).toBeGreaterThan(0);
  });
});
