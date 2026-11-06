import { withAlpha, type ThemeTokens } from '@widgets/core';
import {
  clamp,
  drawChip,
  drawPanel,
  drawProgressBar,
  drawSparkline,
  drawStatusDot,
  drawText,
  roundRectPath,
  type Ctx,
  type HitCollector,
  type Rect,
} from '@widgets/render';
import type { GridGeometry } from '../layout';

export { drawSparkline } from '@widgets/render';
import type { ContainerCard, ContainerGridViewModel } from '../view-model';

/**
 * The card grid.
 *
 * Only the cards inside the virtualised window are painted; each one registers a
 * hit region, which is how hover, selection and the 2D keyboard navigation stay
 * in sync with what is on screen.
 */

export interface CardsOptions {
  geometry: GridGeometry;
  cardHeight: number;
  cardGap: number;
  /** Region id under the pointer (hover tint). */
  hoverId?: string;
}

export function drawCards(
  ctx: Ctx,
  rect: Rect,
  vm: ContainerGridViewModel,
  theme: ThemeTokens,
  add: HitCollector,
  options: CardsOptions,
): void {
  const { geometry, cardHeight, cardGap } = options;

  if (vm.cards.items.length === 0) {
    drawCardPlaceholder(ctx, rect, vm, theme);
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();

  for (const card of vm.cards.items) {
    const row = Math.floor(card.index / geometry.columns);
    const column = card.index % geometry.columns;
    const cardRect: Rect = {
      x: rect.x + column * (geometry.cardWidth + cardGap),
      y: rect.y + row * geometry.rowStride - vm.cards.scrollTop,
      width: geometry.cardWidth,
      height: cardHeight,
    };
    drawCard(ctx, cardRect, card, theme, { hovered: options.hoverId === `card-${card.id}` });
    add({
      id: `card-${card.id}`,
      rect: cardRect,
      tooltip: `${card.namespace}/${card.name} · ${card.statusLabel} · ${card.cpu.valueLabel} · ${card.memory.valueLabel}`,
      action: 'select-card',
      payload: { id: card.id, index: card.index },
    });
  }

  ctx.restore();
  drawScrollbar(ctx, rect, vm, theme, geometry);
}

function drawCard(
  ctx: Ctx,
  rect: Rect,
  card: ContainerCard,
  theme: ThemeTokens,
  state: { hovered: boolean },
): void {
  const critical = card.health === 'critical';
  const accent = card.statusColor;

  drawPanel(ctx, rect, theme, 12);
  if (critical || card.selected) {
    ctx.beginPath();
    roundRectPath(ctx, rect.x, rect.y, rect.width, rect.height, 12);
    ctx.fillStyle = withAlpha(accent, card.selected ? 0.14 : 0.09);
    ctx.fill();
  }
  if (state.hovered) {
    ctx.beginPath();
    roundRectPath(ctx, rect.x, rect.y, rect.width, rect.height, 12);
    ctx.fillStyle = withAlpha(theme.text, 0.04);
    ctx.fill();
  }
  if (critical || card.selected) {
    ctx.beginPath();
    roundRectPath(ctx, rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1, 12);
    ctx.strokeStyle = withAlpha(accent, card.selected ? 0.85 : 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Status rail.
  ctx.beginPath();
  roundRectPath(ctx, rect.x + 3, rect.y + 10, 3, Math.max(6, rect.height - 20), 2);
  ctx.fillStyle = accent;
  ctx.fill();

  const padding = 12;
  const left = rect.x + padding + 4;
  const right = rect.x + rect.width - padding;
  const headerY = rect.y + 18;

  drawStatusDot(ctx, left + 3, headerY, 3.4, card.health, theme);

  const badgeWidth = card.restarts > 0 ? 46 : 0;
  drawText(ctx, card.name, left + 13, headerY, {
    size: 12.5,
    weight: 700,
    color: theme.text,
    maxWidth: Math.max(40, rect.width - padding * 2 - 20 - badgeWidth),
  });
  if (card.restarts > 0) {
    drawChip(
      ctx,
      right,
      headerY - 9,
      `${card.restarts}↻`,
      theme.status[card.restarts >= 3 ? 'critical' : 'warning'],
      theme,
      { align: 'right', height: 18, fontSize: 10 },
    );
  }

  // Metadata line: namespace chip, phase, node (or the attention note).
  let metaX = left;
  const metaY = headerY + 18;
  const namespaceWidth = ctx.measureText(card.namespace).width + 20;
  ctx.beginPath();
  roundRectPath(ctx, metaX, metaY - 8, namespaceWidth, 16, 8);
  ctx.fillStyle = withAlpha(theme.accents[2]!, 0.16);
  ctx.fill();
  drawText(ctx, card.namespace, metaX + namespaceWidth / 2, metaY, {
    size: 9.5,
    weight: 600,
    color: theme.text,
    align: 'center',
    maxWidth: namespaceWidth - 8,
  });
  metaX += namespaceWidth + 6;

  if (card.note && card.health !== 'ok') {
    drawText(ctx, card.note, right, metaY, {
      size: 9,
      weight: 600,
      color: withAlpha(card.statusColor, 0.95),
      align: 'right',
      maxWidth: Math.max(60, rect.width * 0.5),
    });
  } else if (!card.compact && card.node) {
    drawText(ctx, card.node, right, metaY, {
      size: 9,
      weight: 500,
      color: theme.textFaint,
      align: 'right',
      maxWidth: 96,
    });
  }
  drawText(ctx, `${card.statusLabel}${card.workloadKind ? ` · ${card.workloadKind}` : ''}`, metaX, metaY, {
    size: 9.5,
    weight: 600,
    color: theme.textMuted,
    maxWidth: Math.max(20, right - metaX - (card.node ? 100 : 60)),
  });

  // Resource bars.
  const barWidth = rect.width - padding * 2;
  const barHeight = 5;
  const cpuY = metaY + 20;
  drawMetricRow(ctx, {
    x: left,
    right,
    y: cpuY,
    label: card.cpu.label,
    valueLabel: card.cpu.valueLabel,
    percent: card.cpu.percent,
    color: theme.accents[0]!,
    barWidth,
    barHeight,
    theme,
  });
  const memY = cpuY + 26;
  drawMetricRow(ctx, {
    x: left,
    right,
    y: memY,
    label: card.memory.label,
    valueLabel: card.memory.valueLabel,
    percent: card.memory.percent,
    color: theme.accents[1]!,
    barWidth,
    barHeight,
    theme,
  });

  // Footer: readiness, age, image tag and the CPU sparkline.
  const footerY = rect.y + rect.height - 13;
  const sparkWidth = card.compact ? 0 : 58;
  drawText(ctx, `${card.readyLabel} ready`, left, footerY, {
    size: 9.5,
    weight: 600,
    color: card.ready ? theme.status.ok : theme.status.critical,
    maxWidth: 62,
  });
  drawText(ctx, card.ageLabel, left + 64, footerY, {
    size: 9.5,
    weight: 600,
    color: theme.textMuted,
    maxWidth: 62,
  });
  if (!card.compact) {
    drawText(ctx, card.imageTag, left + 126, footerY, {
      size: 9,
      weight: 600,
      color: theme.textFaint,
      maxWidth: Math.max(20, rect.width - padding * 2 - 134 - sparkWidth),
    });
    if (card.spark.length > 1) {
      drawSparkline(
        ctx,
        { x: right - sparkWidth, y: footerY - 10, width: sparkWidth, height: 20 },
        card.spark,
        accent,
        theme,
      );
    }
  }
}

interface MetricRowOptions {
  x: number;
  right: number;
  y: number;
  label: string;
  valueLabel: string;
  percent: number;
  color: string;
  barWidth: number;
  barHeight: number;
  theme: ThemeTokens;
}

function drawMetricRow(ctx: Ctx, options: MetricRowOptions): void {
  const { x, right, y, label, valueLabel, percent, color, barWidth, barHeight, theme } = options;
  drawText(ctx, label, x, y, { size: 9, weight: 700, color: theme.textFaint });
  drawText(ctx, valueLabel, right, y, {
    size: 9.5,
    weight: 600,
    color: theme.textMuted,
    align: 'right',
    maxWidth: barWidth - 30,
  });
  drawProgressBar(ctx, {
    rect: { x, y: y + 7, width: barWidth, height: barHeight },
    value: clamp(percent, 0, 100),
    color,
    track: theme.track,
    radius: barHeight / 2,
  });
}


/** Proportional scrollbar for the grid. */
function drawScrollbar(
  ctx: Ctx,
  rect: Rect,
  vm: ContainerGridViewModel,
  theme: ThemeTokens,
  geometry: GridGeometry,
): void {
  const totalRows = Math.ceil(vm.cards.filteredTotal / Math.max(1, geometry.columns));
  const contentHeight = totalRows * geometry.rowStride;
  if (contentHeight <= rect.height) return;

  const track: Rect = { x: rect.x + rect.width - 6, y: rect.y, width: 4, height: rect.height };
  ctx.beginPath();
  roundRectPath(ctx, track.x, track.y, track.width, track.height, 2);
  ctx.fillStyle = withAlpha(theme.text, 0.06);
  ctx.fill();

  const ratio = clamp(rect.height / contentHeight, 0.08, 1);
  const thumbHeight = Math.max(28, rect.height * ratio);
  const maxScroll = Math.max(1, contentHeight - rect.height);
  const progress = clamp(vm.cards.scrollTop / maxScroll, 0, 1);

  ctx.beginPath();
  roundRectPath(ctx, track.x, track.y + (track.height - thumbHeight) * progress, track.width, thumbHeight, 2);
  ctx.fillStyle = withAlpha(theme.text, 0.26);
  ctx.fill();
}

function drawCardPlaceholder(ctx: Ctx, rect: Rect, vm: ContainerGridViewModel, theme: ThemeTokens): void {
  const width = Math.min(360, rect.width - 20);
  const height = 44;
  const x = rect.x + (rect.width - width) / 2;
  const y = rect.y + Math.max(24, rect.height / 2 - height / 2);
  ctx.beginPath();
  roundRectPath(ctx, x, y, width, height, 10);
  ctx.fillStyle = theme.surfaceRaised;
  ctx.fill();
  drawText(ctx, vm.cards.pending ? vm.cards.pendingLabel : vm.cards.emptyLabel, x + width / 2, y + height / 2, {
    size: 11.5,
    weight: 600,
    color: theme.textMuted,
    align: 'center',
    maxWidth: width - 20,
  });
}

