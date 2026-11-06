import { formatPercent, withAlpha, type ThemeTokens } from '@widgets/core';
import {
  drawIconButton,
  drawPanel,
  drawStatusDot,
  drawText,
  roundRectPath,
  type Ctx,
  type HitCollector,
  type Rect,
} from '@widgets/render';
import type { LogViewModel } from '../view-model';

/** Chrome of the log widget: toolbar, filter strip, analytics and inspector. */

const TOOLBAR_ICON_CYCLE = ['logs', 'share', 'location', 'link'] as const;

export function drawToolbar(
  ctx: Ctx,
  rect: Rect,
  vm: LogViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme, 12);
  const padding = 14;
  const status = vm.toolbar.connection;
  const tone =
    status.state === 'live'
      ? 'ok'
      : status.state === 'error'
        ? 'critical'
        : status.state === 'reconnecting'
          ? 'warning'
          : 'unknown';

  drawStatusDot(ctx, rect.x + padding + 4, rect.y + rect.height / 2, 4, tone, theme);
  const titleWidth = drawText(ctx, vm.toolbar.title, rect.x + padding + 16, rect.y + rect.height / 2 - 7, {
    size: 13,
    weight: 700,
    color: theme.text,
    maxWidth: rect.width * 0.3,
  });
  drawText(
    ctx,
    `${status.label} · ${vm.stream.label}`,
    rect.x + padding + 16 + titleWidth + 10,
    rect.y + rect.height / 2 - 7,
    {
      size: 10,
      weight: 600,
      color: theme.textMuted,
      maxWidth: Math.max(40, rect.width * 0.24),
    },
  );
  drawText(ctx, status.description, rect.x + padding + 16, rect.y + rect.height / 2 + 8, {
    size: 9.5,
    weight: 500,
    color: theme.textFaint,
    maxWidth: rect.width * 0.45,
  });

  drawCounters(ctx, rect, vm, theme, add, padding);
  drawActions(ctx, rect, vm, theme, add, padding);
}

function drawCounters(
  ctx: Ctx,
  rect: Rect,
  vm: LogViewModel,
  theme: ThemeTokens,
  add: HitCollector,
  padding: number,
): void {
  const counterWidth = 62;
  const actionSpan = (Math.max(10, Math.min(15, rect.height * 0.3)) * 2 + 8) * vm.toolbar.actions.length;
  const countersRight = rect.x + rect.width - padding - actionSpan - 8;
  const available = countersRight - (rect.x + rect.width * 0.45);
  const visible = Math.max(1, Math.floor(available / counterWidth));

  vm.toolbar.counters.slice(0, Math.max(0, visible)).forEach((counter, index) => {
    const cx = countersRight - counterWidth * (index + 1);
    const centerX = cx + counterWidth / 2;
    const color =
      counter.tone === 'critical'
        ? theme.status.critical
        : counter.tone === 'warning'
          ? theme.status.warning
          : counter.tone === 'ok'
            ? theme.status.ok
            : theme.text;
    drawText(ctx, counter.value, centerX, rect.y + rect.height / 2 - 6, {
      size: 14,
      weight: 800,
      color,
      align: 'center',
      maxWidth: counterWidth - 8,
    });
    drawText(ctx, counter.label, centerX, rect.y + rect.height / 2 + 10, {
      size: 8.5,
      weight: 600,
      color: theme.textFaint,
      align: 'center',
      maxWidth: counterWidth - 4,
    });
    add({
      id: `counter-${counter.id}`,
      rect: { x: cx, y: rect.y + 4, width: counterWidth, height: rect.height - 8 },
      tooltip: `${counter.label}: ${counter.value}`,
    });
  });
}

function drawActions(
  ctx: Ctx,
  rect: Rect,
  vm: LogViewModel,
  theme: ThemeTokens,
  add: HitCollector,
  padding: number,
): void {
  const actionRadius = Math.max(10, Math.min(15, rect.height * 0.3));
  const gap = actionRadius * 2 + 8;
  const right = rect.x + rect.width - padding;

  vm.toolbar.actions.forEach((action, index) => {
    const cx = right - actionRadius - index * gap;
    if (cx - actionRadius < rect.x + rect.width * 0.5) return;
    const cy = rect.y + rect.height / 2;
    ctx.globalAlpha = action.disabled ? 0.42 : 1;
    drawIconButton(ctx, {
      cx,
      cy,
      radius: actionRadius,
      icon: TOOLBAR_ICON_CYCLE[index % TOOLBAR_ICON_CYCLE.length]!,
      theme,
      ...(action.active ? { accent: theme.status.ok } : {}),
      ...(action.id === 'clear' ? { iconColor: theme.status.warning } : {}),
    });
    ctx.globalAlpha = 1;
    if (!action.disabled) {
      add({
        id: `action-${action.id}`,
        rect: { x: cx - actionRadius, y: cy - actionRadius, width: actionRadius * 2, height: actionRadius * 2 },
        shape: 'circle',
        radius: actionRadius * 1.15,
        tooltip: action.label,
        action: action.id,
      });
    }
  });
}

/** Severity chips with live counts + service chips (top services). */
export function drawFilters(
  ctx: Ctx,
  rect: Rect,
  vm: LogViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme, 12);
  const padding = 12;
  const chipHeight = Math.max(20, Math.min(26, rect.height * 0.44));
  const top = rect.y + (rect.height - chipHeight) / 2;
  const maxX = rect.x + rect.width - padding;
  let cursor = rect.x + padding;

  for (const chip of vm.filters.levels) {
    const label = chip.level === 'all' ? chip.label : `${chip.label} ${chip.count}`;
    const width = chipWidth(ctx, label, chipHeight);
    if (cursor + width > maxX) break;
    drawFilterChip(ctx, { x: cursor, y: top, width, height: chipHeight }, label, chip.color, chip.active, theme);
    add({
      id: `filter-level-${chip.level}`,
      rect: { x: cursor, y: top, width, height: chipHeight },
      tooltip: `${chip.label} · ${chip.count}`,
      action: `filter-level:${chip.level}`,
    });
    cursor += width + 6;
  }

  cursor += 4;
  for (const chip of vm.filters.services) {
    const label = `${chip.service} ${chip.count}`;
    const width = chipWidth(ctx, label, chipHeight);
    if (cursor + width > maxX) break;
    drawFilterChip(ctx, { x: cursor, y: top, width, height: chipHeight }, label, chip.color, chip.active, theme, true);
    add({
      id: `filter-service-${chip.service}`,
      rect: { x: cursor, y: top, width, height: chipHeight },
      tooltip: `${chip.service} · ${chip.count}`,
      action: `filter-service:${chip.service}`,
    });
    cursor += width + 6;
  }
}

function chipWidth(ctx: Ctx, label: string, height: number): number {
  return Math.max(height + 10, ctx.measureText(label).width + 24);
}

function drawFilterChip(
  ctx: Ctx,
  rect: Rect,
  label: string,
  color: string,
  active: boolean,
  theme: ThemeTokens,
  dot = false,
): void {
  ctx.beginPath();
  roundRectPath(ctx, rect.x, rect.y, rect.width, rect.height, rect.height / 2);
  ctx.fillStyle = active ? withAlpha(color, 0.22) : theme.surfaceRaised;
  ctx.fill();
  ctx.strokeStyle = active ? color : theme.border;
  ctx.lineWidth = active ? 1.4 : 1;
  ctx.stroke();

  let textX = rect.x + rect.width / 2;
  if (dot) {
    ctx.beginPath();
    ctx.arc(rect.x + 11, rect.y + rect.height / 2, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    textX += 4;
  }
  drawText(ctx, label, textX, rect.y + rect.height / 2 + 0.5, {
    size: 10.5,
    weight: 600,
    color: active ? theme.text : theme.textMuted,
    align: 'center',
    maxWidth: rect.width - 20,
  });
}

/** Horizontal stacked distribution of the buffered lines by severity. */
export function drawSeverityMix(
  ctx: Ctx,
  rect: Rect,
  vm: LogViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme, 12);
  const padding = 14;
  drawText(ctx, 'Severity mix', rect.x + padding, rect.y + 16, {
    size: 11.5,
    weight: 700,
    color: theme.text,
  });
  const toneColor =
    vm.severityMix.tone === 'critical'
      ? theme.status.critical
      : vm.severityMix.tone === 'warning'
        ? theme.status.warning
        : theme.status.ok;
  drawText(ctx, vm.severityMix.errorRateLabel, rect.x + rect.width - padding, rect.y + 16, {
    size: 10.5,
    weight: 700,
    color: toneColor,
    align: 'right',
    maxWidth: rect.width * 0.5,
  });

  const barY = rect.y + rect.height - 32;
  const barWidth = Math.max(10, rect.width - padding * 2);
  const barHeight = 10;
  ctx.beginPath();
  roundRectPath(ctx, rect.x + padding, barY, barWidth, barHeight, barHeight / 2);
  ctx.fillStyle = theme.track;
  ctx.fill();

  let cursor = rect.x + padding;
  if (vm.severityMix.total > 0) {
    for (const segment of vm.severityMix.segments) {
      const width = (barWidth * segment.count) / vm.severityMix.total;
      if (width < 0.5) continue;
      ctx.beginPath();
      roundRectPath(ctx, cursor, barY, width, barHeight, 3);
      ctx.fillStyle = segment.color;
      ctx.fill();
      add({
        id: `mix-${segment.level}`,
        rect: { x: cursor, y: barY - 6, width, height: barHeight + 12 },
        tooltip: `${segment.level} · ${segment.count} (${formatPercent(segment.percent, 0)})`,
        payload: { level: segment.level, count: segment.count },
      });
      cursor += width;
    }
  }

  drawText(ctx, `${vm.severityMix.total} lines`, rect.x + padding, barY + barHeight + 11, {
    size: 9.5,
    weight: 600,
    color: theme.textMuted,
    maxWidth: barWidth,
  });
}

