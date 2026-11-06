import type { Rect } from '@widgets/render';

/**
 * Layout engine for the log stream widget.
 *
 * Same philosophy as the server-monitor layout: fully pure, so the responsive
 * behaviour (two columns, priority-based section dropping, virtualised stream
 * window) is unit-testable without a canvas.
 */

export type LogSectionId =
  | 'toolbar'
  | 'filters'
  | 'stream'
  | 'severityMix'
  | 'histogram'
  | 'detail'
  | 'services';

export interface LogLayoutOptions {
  width: number;
  height: number;
  columns?: 1 | 2;
  breakpoint?: number;
  padding?: number;
  gap?: number;
  hidden?: readonly LogSectionId[];
  /** Height reserved for the toolbar strip (default 54). */
  toolbarHeight?: number;
  /** Height reserved for the filter strip (default 58). */
  filtersHeight?: number;
}

export interface LogLayout {
  width: number;
  height: number;
  padding: number;
  gap: number;
  columns: 1 | 2;
  /** Full-width chrome strip above the columns. */
  toolbar: Rect;
  /** Region available to the columns (below the toolbar). */
  content: Rect;
  sections: Partial<Record<LogSectionId, Rect>>;
  order: LogSectionId[];
  dropped: LogSectionId[];
}

interface SideSpec {
  id: LogSectionId;
  weight: number;
  minHeight: number;
  /** Higher = dropped earlier when space runs out. */
  priority: number;
}

/** Right column stack: analytics + inspector. */
const SIDE_SECTIONS: readonly SideSpec[] = [
  { id: 'severityMix', weight: 0.5, minHeight: 56, priority: 3 },
  { id: 'histogram', weight: 1.15, minHeight: 118, priority: 4 },
  { id: 'services', weight: 0.95, minHeight: 104, priority: 6 },
  { id: 'detail', weight: 1.25, minHeight: 148, priority: 5 },
];

/** Single-column order when the widget is narrow. */
const NARROW_SECTIONS: readonly SideSpec[] = [
  { id: 'severityMix', weight: 0.45, minHeight: 52, priority: 3 },
  { id: 'histogram', weight: 0.9, minHeight: 108, priority: 4 },
  { id: 'detail', weight: 1.1, minHeight: 140, priority: 5 },
  { id: 'services', weight: 0.85, minHeight: 100, priority: 6 },
];

export const LOG_SECTIONS: readonly LogSectionId[] = [
  'toolbar',
  'filters',
  'stream',
  'severityMix',
  'histogram',
  'detail',
  'services',
];

export function computeLogLayout(options: LogLayoutOptions): LogLayout {
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const padding = options.padding ?? (width < 560 ? 10 : 16);
  const gap = options.gap ?? (width < 560 ? 10 : 14);
  const breakpoint = options.breakpoint ?? 900;
  const hidden = new Set<LogSectionId>(options.hidden ?? []);

  const columns: 1 | 2 = options.columns ?? (width >= breakpoint ? 2 : 1);
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);

  const toolbarHeight = Math.min(
    Math.max(40, options.toolbarHeight ?? (width < 560 ? 46 : 54)),
    Math.max(40, innerHeight * 0.25),
  );
  const filtersHeight = Math.min(
    Math.max(36, options.filtersHeight ?? 58),
    Math.max(36, innerHeight * 0.2),
  );

  const toolbar: Rect = { x: padding, y: padding, width: innerWidth, height: toolbarHeight };
  const content: Rect = {
    x: padding,
    y: padding + toolbarHeight + gap,
    width: innerWidth,
    height: Math.max(1, innerHeight - toolbarHeight - gap),
  };

  const sections: Partial<Record<LogSectionId, Rect>> = {};
  const dropped: LogSectionId[] = [];
  const order: LogSectionId[] = [];
  if (hidden.has('toolbar')) {
    dropped.push('toolbar');
  } else {
    sections.toolbar = toolbar;
    order.push('toolbar');
  }

  if (columns === 1) {
    // Stream first (that is the point of the widget), analytics underneath.
    const stack = ([
      { id: 'filters', weight: 0, minHeight: filtersHeight, priority: 2 },
      {
        id: 'stream',
        weight: 2.4,
        minHeight: Math.min(200, Math.max(120, content.height * 0.35)),
        priority: 0,
      },
      ...NARROW_SECTIONS,
    ] satisfies SideSpec[]).filter((spec) => !hidden.has(spec.id));

    const result = distribute(stack, content, gap);
    Object.assign(sections, result.rects);
    dropped.push(...result.dropped);
    order.push(...result.order);
  } else {
    const columnGap = gap * 2;
    const leftWidth = Math.round((content.width - columnGap) * 0.66);
    const rightWidth = content.width - columnGap - leftWidth;

    const left = distribute(
      ([
        { id: 'filters', weight: 0, minHeight: filtersHeight, priority: 2 },
        {
          id: 'stream',
          weight: 3,
          minHeight: Math.min(220, Math.max(140, content.height * 0.4)),
          priority: 0,
        },
      ] satisfies SideSpec[]).filter((spec) => !hidden.has(spec.id)),
      { x: content.x, y: content.y, width: leftWidth, height: content.height },
      gap,
    );

    const right = distribute(
      SIDE_SECTIONS.filter((spec) => !hidden.has(spec.id)),
      { x: content.x + leftWidth + columnGap, y: content.y, width: rightWidth, height: content.height },
      gap,
    );

    Object.assign(sections, left.rects, right.rects);
    dropped.push(...left.dropped, ...right.dropped);
    order.push(...left.order, ...right.order);
  }

  return { width, height, padding, gap, columns, toolbar, content, sections, order, dropped };
}


/**
 * Distributes `available.height` across sections by weight, honouring minimums.
 * `weight === 0` marks a fixed-height section (the filter strip). When space runs
 * out, the highest priority number is dropped first.
 */
function distribute(
  specs: readonly SideSpec[],
  available: Rect,
  gap: number,
): {
  rects: Partial<Record<LogSectionId, Rect>>;
  order: LogSectionId[];
  dropped: LogSectionId[];
} {
  let active = [...specs];
  const fits = () =>
    active.reduce((sum, spec) => sum + spec.minHeight, 0) + gap * Math.max(0, active.length - 1) <=
    available.height;

  while (active.length > 0 && !fits()) {
    const victim = [...active].sort((a, b) => b.priority - a.priority)[0]!;
    active = active.filter((spec) => spec !== victim);
  }

  const dropped = specs.filter((spec) => !active.includes(spec)).map((spec) => spec.id);
  const totalGap = gap * Math.max(0, active.length - 1);
  const usable = Math.max(0, available.height - totalGap);
  const flexibleSpecs = active.filter((spec) => spec.weight > 0);
  const fixedTotal = active.reduce((sum, spec) => sum + (spec.weight === 0 ? spec.minHeight : 0), 0);
  const flexibleWeight = flexibleSpecs.reduce((sum, spec) => sum + spec.weight, 0) || 1;
  const flexibleSpace = Math.max(
    0,
    usable - fixedTotal - flexibleSpecs.reduce((sum, spec) => sum + spec.minHeight, 0),
  );

  const rects: Partial<Record<LogSectionId, Rect>> = {};
  let cursor = available.y;
  active.forEach((spec, index) => {
    const isLast = index === active.length - 1;
    const height = isLast
      ? available.y + usable - cursor
      : spec.weight === 0
        ? spec.minHeight
        : spec.minHeight + (flexibleSpace * spec.weight) / flexibleWeight;
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

export interface StreamWindow {
  /** Index of the first rendered row. */
  first: number;
  /** Number of rendered rows (viewport + overscan, clamped to the data). */
  count: number;
  /** Y offset of the first rendered row inside the viewport. */
  offset: number;
  /** Virtualised rows hidden above the window. */
  topPad: number;
  /** Virtualised rows hidden below the window. */
  bottomPad: number;
}

/**
 * Virtualisation window for the stream list.
 *
 * Pure maths: given the viewport rect, the row height and the scroll offset it
 * returns exactly which rows to draw (plus spacers), so the renderer paints
 * O(viewport) rows out of O(maxEntries) buffered lines.
 */
export function computeStreamWindow(
  viewport: Rect,
  rowHeight: number,
  total: number,
  scrollTop: number,
  overscan = 4,
): StreamWindow {
  const safeRowHeight = Math.max(8, rowHeight);
  const over = Math.max(0, Math.floor(overscan));
  const rows = Math.max(1, Math.ceil(viewport.height / safeRowHeight));
  const renderCount = rows + over * 2;
  const safeTotal = Math.max(0, total);
  // Never scroll past the end even if the caller passes an out-of-range offset.
  const maxFirst = Math.max(0, safeTotal - renderCount);
  const firstVisible = Math.floor(Math.max(0, scrollTop) / safeRowHeight);
  const first = Math.min(Math.max(0, firstVisible - over), maxFirst);
  const count = Math.min(Math.max(0, safeTotal - first), renderCount);
  const offset = first * safeRowHeight - Math.max(0, scrollTop);
  const contentBottom = (first + count) * safeRowHeight;
  return {
    first,
    count,
    offset,
    topPad: first * safeRowHeight,
    bottomPad: Math.max(0, safeTotal * safeRowHeight - contentBottom),
  };
}

/** Maximum scroll offset for the given data/viewport (in content pixels). */
export function maxScrollTop(total: number, rowHeight: number, viewportHeight: number): number {
  return Math.max(0, total * Math.max(8, rowHeight) - Math.max(0, viewportHeight));
}

