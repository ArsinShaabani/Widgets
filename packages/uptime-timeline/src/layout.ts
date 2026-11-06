import type { Rect } from '@widgets/render';

/**
 * Layout engine for the uptime timeline widget.
 *
 * Pure, so the responsive behaviour is unit-testable: a full-width toolbar and
 * filter strip, then the availability heatmap next to a side stack (SLO,
 * incidents, detail), with row-based virtualisation for large fleets.
 */

export type TimelineSectionId = 'toolbar' | 'filters' | 'timeline' | 'slo' | 'incidents' | 'detail';

export interface TimelineLayoutOptions {
  width: number;
  height: number;
  /** Force a column count for the whole widget; default is responsive. */
  columns?: 1 | 2;
  breakpoint?: number;
  padding?: number;
  gap?: number;
  hidden?: readonly TimelineSectionId[];
  toolbarHeight?: number;
  filtersHeight?: number;
  /** Timeline row height (default 30). */
  rowHeight?: number;
  /** Preferred day-cell width (default 11). */
  cellWidth?: number;
  /** Days in the history window (default 90). */
  days?: number;
}

export interface TimelineGeometry {
  /** Width reserved for the service label column. */
  labelWidth: number;
  /** Effective width of one day cell (shrinks to fit). */
  cellWidth: number;
  /** Gap between cells. */
  cellGap: number;
  /** Vertical distance between rows. */
  rowStride: number;
  /** Rows fully visible in the viewport. */
  visibleRows: number;
  /** Days covered by the history. */
  days: number;
}

export interface TimelineLayout {
  width: number;
  height: number;
  padding: number;
  gap: number;
  columns: 1 | 2;
  toolbar: Rect;
  content: Rect;
  sections: Partial<Record<TimelineSectionId, Rect>>;
  order: TimelineSectionId[];
  dropped: TimelineSectionId[];
  geometry: TimelineGeometry;
}

interface SideSpec {
  id: TimelineSectionId;
  weight: number;
  minHeight: number;
  priority: number;
}

/** Right column stack: SLO rollup, incident log, inspector. */
const SIDE_SECTIONS: readonly SideSpec[] = [
  { id: 'slo', weight: 0.95, minHeight: 126, priority: 3 },
  { id: 'incidents', weight: 1.2, minHeight: 138, priority: 4 },
  { id: 'detail', weight: 1.25, minHeight: 150, priority: 5 },
];

const NARROW_SECTIONS: readonly SideSpec[] = [
  { id: 'slo', weight: 0.85, minHeight: 116, priority: 3 },
  { id: 'incidents', weight: 1.1, minHeight: 128, priority: 4 },
  { id: 'detail', weight: 1.1, minHeight: 140, priority: 5 },
];

export const TIMELINE_SECTIONS: readonly TimelineSectionId[] = [
  'toolbar',
  'filters',
  'timeline',
  'slo',
  'incidents',
  'detail',
];

export function computeTimelineLayout(options: TimelineLayoutOptions): TimelineLayout {
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const padding = options.padding ?? (width < 640 ? 10 : 16);
  const gap = options.gap ?? (width < 640 ? 10 : 14);
  const breakpoint = options.breakpoint ?? 1080;
  const hidden = new Set<TimelineSectionId>(options.hidden ?? []);
  const rowHeight = Math.max(18, options.rowHeight ?? 30);
  const requestedCell = Math.max(4, options.cellWidth ?? 11);
  const days = Math.max(1, options.days ?? 90);

  const columns: 1 | 2 = options.columns ?? (width >= breakpoint ? 2 : 1);
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);

  const toolbarHeight = Math.min(
    Math.max(42, options.toolbarHeight ?? (width < 640 ? 46 : 56)),
    Math.max(42, innerHeight * 0.22),
  );
  const filtersHeight = Math.min(Math.max(34, options.filtersHeight ?? 52), Math.max(34, innerHeight * 0.18));

  const toolbar: Rect = { x: padding, y: padding, width: innerWidth, height: toolbarHeight };
  const filtersRect: Rect = { x: padding, y: padding + toolbarHeight + gap, width: innerWidth, height: filtersHeight };
  const content: Rect = {
    x: padding,
    y: padding + toolbarHeight + gap + (hidden.has('filters') ? 0 : filtersHeight + gap),
    width: innerWidth,
    height: Math.max(1, innerHeight - toolbarHeight - gap - (hidden.has('filters') ? 0 : filtersHeight + gap)),
  };

  const sections: Partial<Record<TimelineSectionId, Rect>> = {};
  const order: TimelineSectionId[] = [];
  const dropped: TimelineSectionId[] = [];

  if (hidden.has('toolbar')) dropped.push('toolbar');
  else {
    sections.toolbar = toolbar;
    order.push('toolbar');
  }
  if (hidden.has('filters')) dropped.push('filters');
  else {
    sections.filters = filtersRect;
    order.push('filters');
  }

  const timelineSpec: SideSpec = {
    id: 'timeline',
    weight: 3,
    minHeight: Math.min(260, Math.max(150, content.height * 0.45)),
    priority: 0,
  };

  if (columns === 1) {
    const stack = ([timelineSpec, ...NARROW_SECTIONS] satisfies SideSpec[]).filter((spec) => !hidden.has(spec.id));
    const result = distribute(stack, content, gap);
    Object.assign(sections, result.rects);
    dropped.push(...result.dropped);
    order.push(...result.order);
  } else {
    const columnGap = gap * 2;
    const rightWidth = Math.round(Math.min(Math.max(content.width * 0.3, 300), content.width * 0.44));
    const leftWidth = Math.max(160, content.width - columnGap - rightWidth);

    const left = distribute([timelineSpec], { x: content.x, y: content.y, width: leftWidth, height: content.height }, gap);
    const right = distribute(
      SIDE_SECTIONS.filter((spec) => !hidden.has(spec.id)),
      { x: content.x + leftWidth + columnGap, y: content.y, width: rightWidth, height: content.height },
      gap,
    );

    Object.assign(sections, left.rects, right.rects);
    dropped.push(...left.dropped, ...right.dropped);
    order.push(...left.order, ...right.order);
  }

  const timelineRect = sections.timeline ?? { x: content.x, y: content.y, width: content.width, height: content.height };
  return {
    width,
    height,
    padding,
    gap,
    columns,
    toolbar,
    content,
    sections,
    order,
    dropped,
    geometry: computeTimelineGeometry(timelineRect, days, rowHeight, requestedCell),
  };
}

/**
 * Label column, day-cell width and row stride for the heatmap.
 *
 * The cells shrink when the viewport cannot fit the preferred width, so a 90 day
 * window always fits without horizontal scrolling.
 */
export interface TimelineWindow {
  /** Index of the first rendered service row. */
  first: number;
  /** Number of rendered rows (viewport + overscan, clamped to the fleet). */
  count: number;
  firstRow: number;
  totalRows: number;
  topPad: number;
  bottomPad: number;
}

/**
 * Row-based virtualisation for the heatmap.
 *
 * Pure maths, clamped so an out-of-range scroll offset can never render past the
 * fleet.
 */
export function computeTimelineWindow(
  geometry: TimelineGeometry,
  total: number,
  scrollTop: number,
  overscanRows = 2,
): TimelineWindow {
  const { rowStride, visibleRows } = geometry;
  const over = Math.max(0, Math.floor(overscanRows));
  const safeTotal = Math.max(0, total);
  const renderRows = visibleRows + over * 2;
  const maxFirstRow = Math.max(0, safeTotal - renderRows);
  const firstVisibleRow = Math.floor(Math.max(0, scrollTop) / rowStride);
  const firstRow = Math.min(Math.max(0, firstVisibleRow - over), maxFirstRow);
  const lastRow = Math.min(safeTotal, firstRow + renderRows);
  return {
    first: firstRow,
    count: Math.max(0, lastRow - firstRow),
    firstRow,
    totalRows: safeTotal,
    topPad: firstRow * rowStride,
    bottomPad: Math.max(0, (safeTotal - lastRow) * rowStride),
  };
}

/** Maximum vertical scroll offset for the heatmap. */
export function maxTimelineScroll(total: number, geometry: TimelineGeometry, viewportHeight: number): number {
  return Math.max(0, Math.max(0, total) * geometry.rowStride - Math.max(0, viewportHeight));
}

function distribute(
  specs: readonly SideSpec[],
  available: Rect,
  gap: number,
): { rects: Partial<Record<TimelineSectionId, Rect>>; order: TimelineSectionId[]; dropped: TimelineSectionId[] } {
  let active = [...specs];
  const fits = () =>
    active.reduce((sum, spec) => sum + spec.minHeight, 0) + gap * Math.max(0, active.length - 1) <=
    available.height;

  while (active.length > 1 && !fits()) {
    const victim = [...active].sort((a, b) => b.priority - a.priority)[0]!;
    active = active.filter((spec) => spec !== victim);
  }

  const dropped = specs.filter((spec) => !active.includes(spec)).map((spec) => spec.id);
  const totalGap = gap * Math.max(0, active.length - 1);
  const usable = Math.max(0, available.height - totalGap);
  const weightTotal = active.reduce((sum, spec) => sum + Math.max(0.01, spec.weight), 0);
  const minimumTotal = active.reduce((sum, spec) => sum + spec.minHeight, 0);
  const flexible = Math.max(0, usable - minimumTotal);

  const rects: Partial<Record<TimelineSectionId, Rect>> = {};
  let cursor = available.y;
  active.forEach((spec, index) => {
    const isLast = index === active.length - 1;
    const height = isLast
      ? available.y + usable - cursor
      : spec.minHeight + (flexible * spec.weight) / weightTotal;
    rects[spec.id] = {
      x: available.x,
      y: cursor,
      width: available.width,
      height: Math.max(0, Math.round(height)),
    };
    cursor += height + gap;
  });

  return { rects, order: active.map((spec) => spec.id), dropped };
}

/**
 * Label column, day-cell width and row stride for the heatmap.
 *
 * The cells shrink when the viewport cannot fit the preferred width, so a 90 day
 * window always fits without horizontal scrolling.
 */
export function computeTimelineGeometry(
  rect: Rect,
  days: number,
  rowHeight: number,
  preferredCellWidth: number,
): TimelineGeometry {
  const safeDays = Math.max(1, Math.floor(days));
  const labelWidth = rect.width < 520 ? Math.min(96, Math.max(64, rect.width * 0.24)) : Math.min(190, Math.max(120, rect.width * 0.21));
  const cellGap = rect.width < 520 ? 1 : 2;
  const available = Math.max(20, rect.width - labelWidth - 8);
  const fitted = (available - cellGap * (safeDays - 1)) / safeDays;
  const cellWidth = Math.max(2, Math.min(preferredCellWidth, fitted));
  const rowStride = Math.max(18, rowHeight);
  const visibleRows = Math.max(1, Math.floor(Math.max(1, rect.height) / rowStride));
  return { labelWidth, cellWidth, cellGap, rowStride, visibleRows, days: safeDays };
}

