import { describe, expect, it } from 'vitest';
import { computeLogLayout, computeStreamWindow, maxScrollTop } from '../src/index';

describe('computeLogLayout', () => {
  it('lays out two columns on a wide viewport with a full-width toolbar', () => {
    const layout = computeLogLayout({ width: 1200, height: 800 });
    expect(layout.columns).toBe(2);
    expect(layout.toolbar.width).toBeGreaterThan(0);
    const stream = layout.sections.stream!;
    const histogram = layout.sections.histogram!;
    expect(stream.x).toBeLessThan(histogram.x);
    expect(stream.y).toBeGreaterThanOrEqual(layout.toolbar.y + layout.toolbar.height);
  });

  it('collapses to one column on a narrow viewport and keeps the stream first', () => {
    const layout = computeLogLayout({ width: 520, height: 820 });
    expect(layout.columns).toBe(1);
    const order = layout.order;
    expect(order.indexOf('stream')).toBeLessThan(order.indexOf('histogram'));
    expect(order.indexOf('stream')).toBeLessThan(order.indexOf('detail'));
  });

  it('never overlaps sections inside a column', () => {
    const layout = computeLogLayout({ width: 1280, height: 820 });
    const right = ['severityMix', 'histogram', 'services', 'detail'] as const;
    const rects = right.map((id) => layout.sections[id]).filter((rect): rect is NonNullable<typeof rect> => Boolean(rect));
    for (let i = 1; i < rects.length; i += 1) {
      expect(rects[i]!.y).toBeGreaterThanOrEqual(rects[i - 1]!.y + rects[i - 1]!.height);
    }
  });

  it('keeps every section inside the widget bounds', () => {
    const layout = computeLogLayout({ width: 900, height: 640 });
    for (const rect of Object.values(layout.sections)) {
      if (!rect) continue;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(901);
      expect(rect.y + rect.height).toBeLessThanOrEqual(641);
    }
  });

  it('drops the lowest priority sections when the height is tiny', () => {
    const layout = computeLogLayout({ width: 1200, height: 280 });
    expect(layout.dropped.length).toBeGreaterThan(0);
    expect(layout.sections.stream).toBeDefined();
    expect(layout.dropped).toContain('services');
  });

  it('honours hidden sections and forced columns', () => {
    const layout = computeLogLayout({ width: 1300, height: 800, hidden: ['histogram', 'services'] });
    expect(layout.sections.histogram).toBeUndefined();
    expect(layout.sections.services).toBeUndefined();
    expect(computeLogLayout({ width: 1300, height: 800, columns: 1 }).columns).toBe(1);
  });
});

describe('computeStreamWindow', () => {
  const viewport = { x: 0, y: 0, width: 600, height: 260 };

  it('renders only the rows around the viewport', () => {
    const window = computeStreamWindow(viewport, 26, 10_000, 0);
    // 10 visible rows + 4 rows of overscan on each side.
    expect(window.first).toBe(0);
    expect(window.count).toBe(18);
    expect(window.topPad).toBe(0);
  });

  it('follows the scroll offset and keeps spacers proportional', () => {
    const window = computeStreamWindow(viewport, 26, 10_000, 2600, 4);
    expect(window.first).toBe(96); // 100 visible - overscan
    expect(window.count).toBe(18);
    expect(window.topPad).toBe(96 * 26);
    expect(window.bottomPad).toBeGreaterThan(0);
    expect(window.offset).toBeCloseTo((100 - 4) * 26 - 2600, 5);
  });

  it('clamps an out-of-range offset to the end of the data', () => {
    const window = computeStreamWindow(viewport, 26, 10, 2600, 4);
    expect(window.first).toBe(0);
    expect(window.count).toBe(10);
    expect(window.bottomPad).toBe(0);
  });

  it('never overlaps: window rows stay inside the data range', () => {
    const window = computeStreamWindow(viewport, 22, 40, 100, 3);
    expect(window.first).toBeGreaterThanOrEqual(0);
    expect(window.first + window.count).toBeLessThanOrEqual(40);
  });
});

describe('maxScrollTop', () => {
  it('is zero when everything fits and grows with the data', () => {
    expect(maxScrollTop(5, 26, 300)).toBe(0);
    expect(maxScrollTop(100, 26, 260)).toBe(100 * 26 - 260);
  });
});
