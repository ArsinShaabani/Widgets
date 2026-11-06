import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/index';

describe('layout', () => {
  it('lays out two columns on a wide viewport', () => {
    const layout = computeLayout({ width: 1200, height: 900 });
    expect(layout.columns).toBe(2);
    expect(layout.dropped).toEqual([]);
    const bars = layout.sections.cpuBars!;
    const host = layout.sections.host!;
    expect(bars.x).toBeLessThan(host.x);
    expect(bars.width + host.width).toBeLessThan(1200);
  });

  it('collapses to a single column on a phone sized viewport', () => {
    const layout = computeLayout({ width: 420, height: 900 });
    expect(layout.columns).toBe(1);
    const xs = new Set(Object.values(layout.sections).map((rect) => rect?.x));
    expect(xs.size).toBe(1);
  });

  it('never overlaps sections inside a column', () => {
    const layout = computeLayout({ width: 1280, height: 840 });
    const left = ['cpuBars', 'donuts', 'gauges', 'network'] as const;
    const rects = left.map((id) => layout.sections[id]!);
    for (let i = 1; i < rects.length; i += 1) {
      expect(rects[i]!.y).toBeGreaterThanOrEqual(rects[i - 1]!.y + rects[i - 1]!.height);
    }
  });

  it('keeps every section inside the widget bounds', () => {
    const layout = computeLayout({ width: 900, height: 700 });
    for (const rect of Object.values(layout.sections)) {
      if (!rect) continue;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(900);
      expect(rect.y + rect.height).toBeLessThanOrEqual(701);
    }
  });

  it('drops the lowest priority sections when the height is tiny', () => {
    const layout = computeLayout({ width: 1200, height: 320 });
    expect(layout.dropped.length).toBeGreaterThan(0);
    // Network keeps its slot (top priority chart), the host card keeps its own.
    expect(layout.sections.network).toBeDefined();
    expect(layout.sections.host).toBeDefined();
    expect(layout.dropped).toContain('actions');
    expect(layout.dropped).toContain('donuts');
  });

  it('honours hidden sections', () => {
    const layout = computeLayout({ width: 1200, height: 800, hidden: ['donuts', 'actions'] });
    expect(layout.sections.donuts).toBeUndefined();
    expect(layout.sections.actions).toBeUndefined();
    expect(layout.order).not.toContain('donuts');
  });

  it('respects a forced column count', () => {
    expect(computeLayout({ width: 1400, height: 900, columns: 1 }).columns).toBe(1);
    expect(computeLayout({ width: 400, height: 900, columns: 2 }).columns).toBe(2);
  });
});
