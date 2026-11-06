import type { Rect } from './geometry';

/**
 * Layout engine for the server monitor dashboard.
 *
 * The reference design is a two column dashboard; the same section list is
 * re-flowed here for wide, narrow and mobile viewports without any DOM queries,
 * which makes the whole layout unit testable.
 */

export type SectionId =
  | 'host'
  | 'badges'
  | 'gauges'
  | 'cpuBars'
  | 'donuts'
  | 'network'
  | 'resourceBars'
  | 'dualBars'
  | 'actions';

export interface SectionSpec {
  id: SectionId;
  /** Relative share of the column height. */
  weight: number;
  /** Minimum comfortable height in px. */
  minHeight: number;
  /** Higher number = dropped earlier when the viewport is too short. */
  priority: number;
}

/** Column A — chart stack (left panel of the reference design). */
export const CHART_SECTIONS: readonly SectionSpec[] = [
  { id: 'cpuBars', weight: 1.25, minHeight: 150, priority: 2 },
  { id: 'donuts', weight: 1.05, minHeight: 150, priority: 4 },
  { id: 'gauges', weight: 0.95, minHeight: 130, priority: 3 },
  { id: 'network', weight: 1.2, minHeight: 150, priority: 1 },
];

/** Column B — host card, status badges, resource bars, action row. */
export const HOST_SECTIONS: readonly SectionSpec[] = [
  { id: 'host', weight: 1.35, minHeight: 190, priority: 0 },
  { id: 'badges', weight: 0.95, minHeight: 110, priority: 5 },
  { id: 'resourceBars', weight: 1.05, minHeight: 120, priority: 6 },
  { id: 'dualBars', weight: 1.05, minHeight: 120, priority: 7 },
  { id: 'actions', weight: 0.52, minHeight: 68, priority: 8 },
];

export interface LayoutOptions {
  width: number;
  height: number;
  /** 1 → stacked single column, 2 → reference two column dashboard. */
  columns?: 1 | 2;
  padding?: number;
  gap?: number;
  /** Minimum width before the dashboard collapses to one column. */
  breakpoint?: number;
  /** Sections to skip entirely (config driven). */
  hidden?: readonly SectionId[];
}

export interface LayoutResult {
  width: number;
  height: number;
  padding: number;
  gap: number;
  columns: 1 | 2;
  /** Rect for every laid-out section. */
  sections: Partial<Record<SectionId, Rect>>;
  /** Section order actually rendered. */
  order: SectionId[];
  /** Sections that did not fit and were dropped. */
  dropped: SectionId[];
  /** True when the height could not satisfy every minimum. */
  overflow: boolean;
}

/** Convenience: unique list of every section id defined above. */
export const ALL_SECTIONS: readonly SectionId[] = [
  ...CHART_SECTIONS.map((spec) => spec.id),
  ...HOST_SECTIONS.map((spec) => spec.id),
];

export function computeLayout(options: LayoutOptions): LayoutResult {
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const padding = options.padding ?? (width < 520 ? 12 : 20);
  const gap = options.gap ?? (width < 520 ? 12 : 16);
  const breakpoint = options.breakpoint ?? 720;
  const hidden = new Set(options.hidden ?? []);

  const columns: 1 | 2 = options.columns ?? (width >= breakpoint ? 2 : 1);
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);
  const visible = (specs: readonly SectionSpec[]) => specs.filter((spec) => !hidden.has(spec.id));

  if (columns === 1) {
    // Single column keeps the host identity first, then the most actionable charts.
    const specList = [
      ...visible(HOST_SECTIONS).filter(
        (spec) => spec.id === 'host' || spec.id === 'badges' || spec.id === 'resourceBars',
      ),
      ...visible(CHART_SECTIONS).filter((spec) => spec.id === 'gauges' || spec.id === 'cpuBars' || spec.id === 'network'),
      ...visible(CHART_SECTIONS).filter((spec) => spec.id === 'donuts'),
      ...visible(HOST_SECTIONS).filter((spec) => spec.id === 'dualBars' || spec.id === 'actions'),
    ];
    const single = distribute(specList, {
      x: padding,
      y: padding,
      width: innerWidth,
      height: innerHeight,
      gap,
    });
    return { width, height, padding, gap, columns, sections: single.rects, order: single.order, dropped: single.dropped, overflow: single.overflow };
  }

  const columnGap = gap * 2;
  const leftWidth = Math.round((innerWidth - columnGap) * 0.62);
  const rightWidth = innerWidth - columnGap - leftWidth;

  const left = distribute(visible(CHART_SECTIONS), {
    x: padding,
    y: padding,
    width: leftWidth,
    height: innerHeight,
    gap,
  });
  const right = distribute(visible(HOST_SECTIONS), {
    x: padding + leftWidth + columnGap,
    y: padding,
    width: rightWidth,
    height: innerHeight,
    gap,
  });

  return {
    width,
    height,
    padding,
    gap,
    columns,
    sections: { ...left.rects, ...right.rects },
    order: [...left.order, ...right.order],
    dropped: [...left.dropped, ...right.dropped],
    overflow: left.overflow || right.overflow,
  };
}

/**
 * Distributes the available height across sections by weight, honouring each
 * section's minimum. When space runs out the lowest priority sections are
 * dropped instead of producing unusable strips.
 */
function distribute(
  specs: readonly SectionSpec[],
  available: Rect & { gap: number },
): {
  rects: Partial<Record<SectionId, Rect>>;
  order: SectionId[];
  dropped: SectionId[];
  overflow: boolean;
} {
  let active = [...specs];
  const fits = () =>
    active.reduce((sum, spec) => sum + spec.minHeight, 0) +
      available.gap * Math.max(0, active.length - 1) <=
    available.height;

  while (active.length > 0 && !fits()) {
    const victim = [...active].sort((a, b) => b.priority - a.priority)[0]!;
    active = active.filter((spec) => spec !== victim);
  }

  const dropped = specs.filter((spec) => !active.includes(spec)).map((spec) => spec.id);
  const totalGap = available.gap * Math.max(0, active.length - 1);
  const usable = Math.max(0, available.height - totalGap);
  const weights = active.map((spec) => Math.max(0.01, spec.weight));
  const weightTotal = weights.reduce((sum, w) => sum + w, 0);
  const minimumTotal = active.reduce((sum, spec) => sum + spec.minHeight, 0);
  const flexible = Math.max(0, usable - minimumTotal);

  const rects: Partial<Record<SectionId, Rect>> = {};
  let cursor = available.y;
  active.forEach((spec, index) => {
    const share = (flexible * weights[index]!) / weightTotal;
    const isLast = index === active.length - 1;
    const sectionHeight = isLast ? available.y + usable - cursor : spec.minHeight + share;
    rects[spec.id] = {
      x: available.x,
      y: cursor,
      width: available.width,
      height: Math.max(0, Math.round(sectionHeight)),
    };
    cursor += sectionHeight + available.gap;
  });

  return { rects, order: active.map((spec) => spec.id), dropped, overflow: false };
}

