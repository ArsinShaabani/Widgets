import { withAlpha, type ThemeTokens } from '@widgets/core';
import { clamp, drawPanel, drawText, roundRectPath, type Ctx, type HitCollector, type Rect } from '@widgets/render';
import type { LogRow, LogViewModel } from '../view-model';

/**
 * Virtualised log list.
 *
 * Only the rows inside the computed window are painted (plus overscan), so the
 * widget stays smooth with tens of thousands of buffered lines. Every row
 * registers a hit region, which is also how hover/selection stay in sync with
 * the pixels that were drawn.
 */

const HEADER_HEIGHT = 24;
const RAIL_WIDTH = 3;

export interface StreamOptions {
  /** Region id currently under the pointer (used for the hover tint). */
  hoverId?: string;
}

export function drawStream(
  ctx: Ctx,
  rect: Rect,
  vm: LogViewModel,
  theme: ThemeTokens,
  add: HitCollector,
  options: StreamOptions = {},
): void {
  drawPanel(ctx, rect, theme);

  const padding = 12;
  const headerHeight = rect.height > 120 ? HEADER_HEIGHT : 0;
  const viewport: Rect = {
    x: rect.x + padding,
    y: rect.y + headerHeight,
    width: Math.max(10, rect.width - padding * 2 - 6),
    height: Math.max(10, rect.height - headerHeight - 10),
  };

  const columns = columnLayout(viewport, vm);

  if (headerHeight > 0) drawStreamHeader(ctx, rect, viewport, columns, theme);

  ctx.save();
  ctx.beginPath();
  ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height);
  ctx.clip();

  if (vm.stream.rows.length === 0) {
    drawText(ctx, vm.stream.emptyMessage, viewport.x + viewport.width / 2, viewport.y + viewport.height / 2, {
      size: 11.5,
      weight: 500,
      color: theme.textFaint,
      align: 'center',
      maxWidth: Math.max(40, viewport.width - 20),
    });
    ctx.restore();
    drawScrollbar(ctx, rect, viewport, vm, theme);
    return;
  }

  for (const row of vm.stream.rows) {
    const rowY = viewport.y + row.index * vm.stream.rowHeight - vm.stream.scrollTop;
    const rowRect: Rect = { x: viewport.x, y: rowY, width: viewport.width, height: vm.stream.rowHeight };
    drawRow(ctx, rowRect, row, columns, theme, { hovered: options.hoverId === `row-${row.id}` });
    add({
      id: `row-${row.id}`,
      rect: rowRect,
      tooltip: `${row.timeLabel} · ${row.service} · ${row.message}`,
      action: 'select-row',
      payload: { id: row.id, index: row.index },
    });
  }

  ctx.restore();
  drawScrollbar(ctx, rect, viewport, vm, theme);
}

interface Columns {
  index: number;
  time: number;
  service: number;
  message: number;
  trailing: number;
}

/** Column widths for the current viewport width (hidden columns collapse to 0). */
export function columnLayout(viewport: Rect, _vm: LogViewModel): Columns {
  const index = viewport.width > 420 ? 46 : 0;
  const time = viewport.width > 520 ? 96 : 74;
  const service = viewport.width > 620 ? 108 : viewport.width > 460 ? 88 : 0;
  const trailing = viewport.width > 700 ? 108 : 0;
  return {
    index,
    time,
    service,
    trailing,
    message: Math.max(40, viewport.width - index - time - service - trailing - 30),
  };
}

function drawStreamHeader(
  ctx: Ctx,
  rect: Rect,
  viewport: Rect,
  columns: Columns,
  theme: ThemeTokens,
): void {
  const y = rect.y + HEADER_HEIGHT * 0.6;
  let x = viewport.x + RAIL_WIDTH + 10;
  drawText(ctx, 'LEVEL', x, y, { size: 8.5, weight: 700, color: theme.textFaint });
  x += columns.index + columns.time - 6;
  drawText(ctx, 'TIME', x, y, { size: 8.5, weight: 700, color: theme.textFaint });
  x += columns.time - 4;
  if (columns.service > 0) {
    drawText(ctx, 'SERVICE', x, y, { size: 8.5, weight: 700, color: theme.textFaint });
    x += columns.service;
  }
  drawText(ctx, 'MESSAGE', x + 4, y, { size: 8.5, weight: 700, color: theme.textFaint });

  ctx.beginPath();
  ctx.moveTo(viewport.x, rect.y + HEADER_HEIGHT);
  ctx.lineTo(viewport.x + viewport.width, rect.y + HEADER_HEIGHT);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawRow(
  ctx: Ctx,
  rect: Rect,
  row: LogRow,
  columns: Columns,
  theme: ThemeTokens,
  state: { hovered: boolean },
): void {
  const background = row.selected
    ? withAlpha(theme.accents[0]!, 0.18)
    : state.hovered
      ? withAlpha(theme.text, 0.05)
      : null;
  if (background) {
    ctx.beginPath();
    roundRectPath(ctx, rect.x, rect.y + 1, rect.width, rect.height - 2, 6);
    ctx.fillStyle = background;
    ctx.fill();
  }

  // Severity rail.
  ctx.beginPath();
  roundRectPath(ctx, rect.x + 2, rect.y + 4, RAIL_WIDTH, Math.max(2, rect.height - 8), 2);
  ctx.fillStyle = row.color;
  ctx.fill();

  const textY = rect.y + rect.height / 2 + 0.5;
  let x = rect.x + RAIL_WIDTH + 10;

  if (columns.index > 0) {
    drawText(ctx, String(row.index + 1), x, textY, {
      size: 9.5,
      weight: 600,
      color: theme.textFaint,
      maxWidth: columns.index - 8,
    });
    x += columns.index;
  }

  drawText(ctx, row.timeLabel, x, textY, {
    size: 10,
    weight: 600,
    color: theme.textMuted,
    maxWidth: columns.time - 8,
  });
  x += columns.time - 4;

  if (columns.service > 0) {
    ctx.beginPath();
    ctx.arc(x + 5, textY, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = row.color;
    ctx.fill();
    drawText(ctx, row.service, x + 13, textY, {
      size: 10,
      weight: 600,
      color: theme.text,
      maxWidth: columns.service - 18,
    });
    x += columns.service;
  }

  const trailingWidth = (row.repeat ? 36 : 0) + (row.traceId && columns.trailing > 0 ? 78 : 0);
  drawText(ctx, row.message, x + 4, textY, {
    size: 11,
    weight: row.selected ? 600 : 500,
    color: row.selected ? theme.text : theme.textMuted,
    maxWidth: Math.max(20, columns.message - trailingWidth),
  });

  let rightX = rect.x + rect.width - 10;
  if (row.repeat) {
    const width = 30;
    ctx.beginPath();
    roundRectPath(ctx, rightX - width, rect.y + rect.height / 2 - 9, width, 18, 4);
    ctx.fillStyle = withAlpha(row.color, 0.25);
    ctx.fill();
    drawText(ctx, `×${row.repeat}`, rightX - width / 2, textY, {
      size: 9.5,
      weight: 700,
      color: theme.text,
      align: 'center',
      maxWidth: width - 4,
    });
    rightX -= width + 6;
  }
  if (row.traceId && columns.trailing > 0) {
    drawText(ctx, row.traceId, rightX, textY, {
      size: 9,
      weight: 600,
      color: theme.textFaint,
      align: 'right',
      maxWidth: columns.trailing - 12,
    });
  }
}

/** Thin, proportional scrollbar indicating (and reflecting) the scroll offset. */
function drawScrollbar(ctx: Ctx, rect: Rect, viewport: Rect, vm: LogViewModel, theme: ThemeTokens): void {
  const contentHeight = vm.stream.filteredTotal * vm.stream.rowHeight;
  if (contentHeight <= viewport.height) return;

  const track: Rect = { x: rect.x + rect.width - 10, y: viewport.y, width: 5, height: viewport.height };
  ctx.beginPath();
  roundRectPath(ctx, track.x, track.y, track.width, track.height, 2.5);
  ctx.fillStyle = withAlpha(theme.text, 0.06);
  ctx.fill();

  const ratio = clamp(viewport.height / contentHeight, 0.08, 1);
  const thumbHeight = Math.max(24, viewport.height * ratio);
  const maxScroll = Math.max(1, contentHeight - viewport.height);
  const progress = clamp(vm.stream.scrollTop / maxScroll, 0, 1);

  ctx.beginPath();
  roundRectPath(ctx, track.x, track.y + (track.height - thumbHeight) * progress, track.width, thumbHeight, 2.5);
  ctx.fillStyle = withAlpha(theme.text, 0.28);
  ctx.fill();
}

