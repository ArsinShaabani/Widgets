import type { Rect } from '@widgets/render';

/**
 * Layout engine for the container grid widget.
 *
 * Pure, so the responsive behaviour is unit-testable: a full-width toolbar and
 * filter strip, then a card grid (whose column count is derived from the
 * available width) next to a summary/inspector column, with row-based
 * virtualisation for large fleets.
 */

export type GridSectionId = 'toolbar' | 'filters' | 'grid' | 'capacity' | 'namespaces' | 'detail';

export interface GridLayoutOptions {
  width: number;
  height: number;
  /** Force a column count for the whole widget; default is responsive. */
  columns?: 1 | 2;
  breakpoint?: number;
  padding?: number;
  gap?: number;
  hidden?: readonly GridSectionId[];
  toolbarHeight?: number;
  filtersHeight?: number;
  /** Minimum card width (default 246). */
  cardMinWidth?: number;
  /** Card height (default 132). */
  cardHeight?: number;
  /** Gap between cards (default 12). */
  cardGap?: number;
}

export interface GridGeometry {
  /** Cards per row. */
  columns: number;
  /** Gap between cards (both axes). */
  cardGap: number;
  /** Width of a single card. */
  cardWidth: number;
  /** Vertical distance between two rows. */
  rowStride: number;
  /** Rows fully visible in the viewport. */
  visibleRows: number;
}

export interface GridLayout {
  width: number;
  height: number;
  padding: number;
  gap: number;
  columns: 1 | 2;
  toolbar: Rect;
  content: Rect;
  sections: Partial<Record<GridSectionId, Rect>>;
  order: GridSectionId[];
  dropped: GridSectionId[];
  /** Card grid geometry for the grid section. */
  grid: GridGeometry;
}

interface SideSpec {
  id: GridSectionId;
  weight: number;
  minHeight: number;
  priority: number;
}

/** Right column stack: capacity rollup, namespace breakdown, inspector. */
const SIDE_SECTIONS: readonly SideSpec[] = [
  { id: 'capacity', weight: 1.0, minHeight: 132, priority: 3 },
  { id: 'namespaces', weight: 0.9, minHeight: 112, priority: 5 },
  { id: 'detail', weight: 1.3, minHeight: 172, priority: 4 },
];

const NARROW_SECTIONS: readonly SideSpec[] = [
  { id: 'capacity', weight: 0.9, minHeight: 120, priority: 3 },
  { id: 'detail', weight: 1.1, minHeight: 160, priority: 4 },
  { id: 'namespaces', weight: 0.8, minHeight: 104, priority: 5 },
];

export const GRID_SECTIONS: readonly GridSectionId[] = [
  'toolbar',
  'filters',
  'grid',
  'capacity',
  'namespaces',
  'detail',
];

export function computeGridLayout(options: GridLayoutOptions): GridLayout {
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const padding = options.padding ?? (width < 640 ? 10 : 16);
  const gap = options.gap ?? (width < 640 ? 10 : 14);
  const breakpoint = options.breakpoint ?? 1020;
  const hidden = new Set<GridSectionId>(options.hidden ?? []);
  const cardMinWidth = Math.max(140, options.cardMinWidth ?? 246);
  const cardHeight = Math.max(96, options.cardHeight ?? 132);
  const cardGap = Math.max(4, options.cardGap ?? 12);

  const columns: 1 | 2 = options.columns ?? (width >= breakpoint ? 2 : 1);
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);

  const toolbarHeight = Math.min(
    Math.max(42, options.toolbarHeight ?? (width < 640 ? 46 : 56)),
    Math.max(42, innerHeight * 0.22),
  );
  const filtersHeight = Math.min(Math.max(34, options.filtersHeight ?? 52), Math.max(34, innerHeight * 0.18));

  const toolbar: Rect = { x: padding, y: padding, width: innerWidth, height: toolbarHeight };
  const filtersRect: Rect = {
    x: padding,
    y: padding + toolbarHeight + gap,
    width: innerWidth,
    height: filtersHeight,
  };
  const content: Rect = {
    x: padding,
    y: padding + toolbarHeight + gap + (hidden.has('filters') ? 0 : filtersHeight + gap),
    width: innerWidth,
    height: Math.max(1, innerHeight - toolbarHeight - gap - (hidden.has('filters') ? 0 : filtersHeight + gap)),
  };

  const sections: Partial<Record<GridSectionId, Rect>> = {};
  const order: GridSectionId[] = [];
  const dropped: GridSectionId[] = [];

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

  const gridSpec: SideSpec = {
    id: 'grid',
    weight: 3,
    minHeight: Math.min(240, Math.max(150, content.height * 0.45)),
    priority: 0,
  };

  if (columns === 1) {
    const stack = ([gridSpec, ...NARROW_SECTIONS] satisfies SideSpec[]).filter((spec) => !hidden.has(spec.id));
    const result = distribute(stack, content, gap);
    Object.assign(sections, result.rects);
    dropped.push(...result.dropped);
    order.push(...result.order);
  } else {
    const columnGap = gap * 2;
    const rightWidth = Math.round(Math.min(Math.max(content.width * 0.3, 280), content.width * 0.42));
    const leftWidth = Math.max(120, content.width - columnGap - rightWidth);

    const left = distribute([gridSpec], { x: content.x, y: content.y, width: leftWidth, height: content.height }, gap);
    const right = distribute(
      SIDE_SECTIONS.filter((spec) => !hidden.has(spec.id)),
      { x: content.x + leftWidth + columnGap, y: content.y, width: rightWidth, height: content.height },
      gap,
    );

    Object.assign(sections, left.rects, right.rects);
    dropped.push(...left.dropped, ...right.dropped);
    order.push(...left.order, ...right.order);
  }

  const gridRect = sections.grid ?? { x: content.x, y: content.y, width: content.width, height: content.height };
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
    grid: computeGridGeometry(gridRect, cardMinWidth, cardHeight, cardGap),
  };
}


/** Column count, card width and row stride for a given grid rect. */
export function computeGridGeometry(
  rect: Rect,
  cardMinWidth: number,
  cardHeight: number,
  cardGap: number,
): GridGeometry {
  const usable = Math.max(1, rect.width);
  const columns = Math.max(1, Math.floor((usable + cardGap) / (cardMinWidth + cardGap)));
  const cardWidth = Math.max(80, (usable - cardGap * (columns - 1)) / columns);
  const rowStride = cardHeight + cardGap;
  const visibleRows = Math.max(1, Math.floor((Math.max(1, rect.height) + cardGap) / rowStride));
  return { columns, cardWidth, rowStride, visibleRows, cardGap };
}

export interface GridWindow {
  /** Index of the first rendered card. */
  first: number;
  /** Number of rendered cards (rows in view + overscan, clamped to the data). */
  count: number;
  /** First rendered row. */
  firstRow: number;
  /** Total rows for the filtered set. */
  totalRows: number;
  /** Virtualised rows hidden above the window. */
  topPad: number;
  /** Virtualised rows hidden below the window. */
  bottomPad: number;
}

/**
 * Row-based virtualisation for the card grid.
 *
 * Pure maths: returns exactly which cards to paint (plus spacers), clamped so an
 * out-of-range scroll offset can never render past the fleet.
 */
export function computeGridWindow(
  geometry: GridGeometry,
  total: number,
  scrollTop: number,
  overscanRows = 1,
): GridWindow {
  const { columns, rowStride, visibleRows } = geometry;
  const over = Math.max(0, Math.floor(overscanRows));
  const safeTotal = Math.max(0, total);
  const totalRows = Math.ceil(safeTotal / columns);
  const renderRows = visibleRows + over * 2;
  const maxFirstRow = Math.max(0, totalRows - renderRows);
  const visibleFirstRow = Math.floor(Math.max(0, scrollTop) / rowStride);
  // Symmetric overscan: one row above and below the viewport by default.
  const firstRow = Math.min(Math.max(0, visibleFirstRow - over), maxFirstRow);
  const lastRow = Math.min(totalRows, firstRow + renderRows);
  const first = firstRow * columns;
  const count = Math.max(0, Math.min(safeTotal - first, (lastRow - firstRow) * columns));
  return {
    first,
    count,
    firstRow,
    totalRows,
    topPad: firstRow * rowStride,
    bottomPad: Math.max(0, (totalRows - lastRow) * rowStride),
  };
}

/** Maximum vertical scroll offset for the grid. */
export function maxGridScroll(total: number, geometry: GridGeometry, viewportHeight: number): number {
  const rows = Math.ceil(Math.max(0, total) / Math.max(1, geometry.columns));
  return Math.max(0, rows * geometry.rowStride - geometry.cardGap - Math.max(0, viewportHeight));
}

function distribute(
  specs: readonly SideSpec[],
  available: Rect,
  gap: number,
): { rects: Partial<Record<GridSectionId, Rect>>; order: GridSectionId[]; dropped: GridSectionId[] } {
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

  const rects: Partial<Record<GridSectionId, Rect>> = {};
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

