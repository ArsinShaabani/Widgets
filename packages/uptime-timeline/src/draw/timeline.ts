import { formatPercent, withAlpha, type ThemeTokens } from '@widgets/core';
import { clamp, drawPanel, drawText, roundRectPath, type Ctx, type HitCollector, type Rect } from '@widgets/render';
import type { TimelineGeometry } from '../layout';
import type { TimelineRow, UptimeViewModel } from '../view-model';

/**
 * The availability heatmap.
 *
 * One row per service: a label column (name, availability, SLO) followed by one
 * cell per day coloured by that day's worst state. Rows are virtualised, so a
 * large fleet stays cheap to paint.
 */

export interface TimelineOptions {
  geometry: TimelineGeometry;
  /** Region id under the pointer (cell hover highlight). */
  hoverId?: string;
}

export function drawTimeline(
  ctx: Ctx,
  rect: Rect,
  vm: UptimeViewModel,
  theme: ThemeTokens,
  add: HitCollector,
  options: TimelineOptions,
): void {
  drawPanel(ctx, rect, theme);
  const padding = 12;
  const days = vm.timeline.days;
  const geometry: TimelineGeometry = { ...options.geometry, days: Math.max(days, 1) };

  drawText(ctx, 'Availability timeline', rect.x + padding, rect.y + 16, {
    size: 12,
    weight: 700,
    color: theme.text,
  });
  drawText(ctx, `${days}d · worst state per day`, rect.x + rect.width - padding, rect.y + 16, {
    size: 9.5,
    weight: 600,
    color: theme.textFaint,
    align: 'right',
    maxWidth: rect.width * 0.5,
  });

  // Header band: title/subtitle above, month markers below, then the rows.
  const axisY = rect.y + 32;
  const viewport: Rect = {
    x: rect.x + padding,
    y: rect.y + 38,
    width: Math.max(20, rect.width - padding * 2 - 8),
    height: Math.max(12, rect.height - 38 - padding),
  };

  if (vm.timeline.rows.length === 0) {
    drawText(
      ctx,
      vm.timeline.pending ? vm.timeline.pendingLabel : vm.timeline.emptyLabel,
      viewport.x + viewport.width / 2,
      viewport.y + viewport.height / 2,
      { size: 11.5, weight: 600, color: theme.textMuted, align: 'center', maxWidth: viewport.width - 20 },
    );
    return;
  }

  drawMonthAxis(ctx, viewport, geometry, vm, theme, axisY);

  ctx.save();
  ctx.beginPath();
  ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height);
  ctx.clip();

  for (const row of vm.timeline.rows) {
    const rowY = viewport.y + row.index * geometry.rowStride - vm.timeline.scrollTop;
    const rowRect: Rect = { x: viewport.x, y: rowY, width: viewport.width, height: geometry.rowStride };
    drawRow(ctx, rowRect, row, geometry, theme, { hovered: options.hoverId === `row-${row.id}`, vm });
    add({
      id: `row-${row.id}`,
      rect: rowRect,
      tooltip: `${row.name} · ${row.uptimeLabel} · ${row.sloLabel}`,
      action: 'select-row',
      payload: { id: row.id, index: row.index },
    });
  }

  ctx.restore();
  drawScrollbar(ctx, rect, vm, geometry, theme);
}

function drawMonthAxis(
  ctx: Ctx,
  viewport: Rect,
  geometry: TimelineGeometry,
  vm: UptimeViewModel,
  theme: ThemeTokens,
  axisY: number,
): void {
  const step = geometry.cellWidth + geometry.cellGap;
  for (const marker of vm.timeline.monthLabels) {
    const x = viewport.x + geometry.labelWidth + marker.index * step + 2;
    if (x > viewport.x + viewport.width - 18) break;
    drawText(ctx, marker.label, x, axisY, { size: 9, weight: 700, color: theme.textFaint });
  }
}

/** One heatmap row: label column + day cells + availability sparkline. */
function drawRow(
  ctx: Ctx,
  rect: Rect,
  row: TimelineRow,
  geometry: TimelineGeometry,
  theme: ThemeTokens,
  state: { hovered: boolean; vm: UptimeViewModel },
): void {
  const background = row.selected
    ? withAlpha(theme.accents[0]!, 0.16)
    : state.hovered
      ? withAlpha(theme.text, 0.05)
      : null;
  if (background) {
    ctx.beginPath();
    roundRectPath(ctx, rect.x, rect.y + 1, rect.width, rect.height - 2, 6);
    ctx.fillStyle = background;
    ctx.fill();
  }

  const labelWidth = geometry.labelWidth;
  const textY = rect.y + rect.height / 2;
  const statusRadius = 3;

  ctx.beginPath();
  ctx.arc(rect.x + 8 + statusRadius, textY, statusRadius, 0, Math.PI * 2);
  ctx.fillStyle = row.statusColor;
  ctx.fill();

  drawText(ctx, row.name, rect.x + 18, textY - (row.compact ? 0 : 6), {
    size: 10.5,
    weight: 600,
    color: theme.text,
    maxWidth: labelWidth - 26,
  });
  if (!row.compact) {
    const meta = `${row.group} · ${row.uptimeLabel}`;
    drawText(ctx, row.breached ? `${meta} · below SLO` : meta, rect.x + 18, textY + 8, {
      size: 9,
      weight: 600,
      color: row.breached ? theme.status.critical : theme.textMuted,
      maxWidth: labelWidth - 26,
    });
  }

  // Day cells.
  const step = geometry.cellWidth + geometry.cellGap;
  const cellsX = rect.x + labelWidth;
  const maxCells = Math.floor((rect.width - labelWidth) / step) + 1;
  const start = Math.max(0, row.cells.length - maxCells);
  const visible = row.cells.slice(start);

  visible.forEach((cell, index) => {
    const x = cellsX + index * step;
    const width = Math.max(2, geometry.cellWidth);
    const height = Math.max(8, rect.height - 12);
    ctx.beginPath();
    roundRectPath(ctx, x, textY - height / 2, width, height, Math.min(2.5, width / 2));
    ctx.fillStyle = withAlpha(cell.color, 0.9);
    ctx.fill();
  });

  // Empty history placeholder cells keep the grid readable.
  const missing = Math.max(0, maxCells - visible.length);
  for (let index = 0; index < missing; index += 1) {
    const x = cellsX + (visible.length + index) * step;
    ctx.beginPath();
    roundRectPath(ctx, x, textY - 4, Math.max(2, geometry.cellWidth), 8, 2);
    ctx.fillStyle = withAlpha(theme.text, 0.06);
    ctx.fill();
  }

  void state.vm;
  void clamp;
  void formatPercent;
}

/** Proportional scrollbar for the heatmap. */
function drawScrollbar(
  ctx: Ctx,
  rect: Rect,
  vm: UptimeViewModel,
  geometry: TimelineGeometry,
  theme: ThemeTokens,
): void {
  const contentHeight = vm.timeline.filteredTotal * geometry.rowStride;
  const viewportHeight = Math.max(12, rect.height - 38 - 12);
  if (contentHeight <= viewportHeight) return;

  const track: Rect = { x: rect.x + rect.width - 10, y: rect.y + 38, width: 4, height: viewportHeight };
  ctx.beginPath();
  roundRectPath(ctx, track.x, track.y, track.width, track.height, 2);
  ctx.fillStyle = withAlpha(theme.text, 0.06);
  ctx.fill();

  const ratio = clamp(viewportHeight / contentHeight, 0.08, 1);
  const thumbHeight = Math.max(24, track.height * ratio);
  const maxScroll = Math.max(1, contentHeight - viewportHeight);
  const progress = clamp(vm.timeline.scrollTop / maxScroll, 0, 1);

  ctx.beginPath();
  roundRectPath(ctx, track.x, track.y + (track.height - thumbHeight) * progress, track.width, thumbHeight, 2);
  ctx.fillStyle = withAlpha(theme.text, 0.26);
  ctx.fill();
}

