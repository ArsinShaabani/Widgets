import { withAlpha, type ThemeTokens } from '@widgets/core';
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
import type { UptimeViewModel } from '../view-model';

/** Chrome of the uptime widget: toolbar and filter strip. */

const ACTION_ICON_CYCLE = ['alert', 'network', 'link'] as const;

export function drawToolbar(
  ctx: Ctx,
  rect: Rect,
  vm: UptimeViewModel,
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

  // Narrow layouts keep only the title (the search field and counters need the room).
  const narrow = rect.width < 620;
  drawStatusDot(ctx, rect.x + padding + 4, rect.y + rect.height / 2, 4, tone, theme);
  if (narrow) {
    drawText(ctx, vm.toolbar.title, rect.x + padding + 16, rect.y + rect.height / 2, {
      size: 13,
      weight: 700,
      color: theme.text,
      maxWidth: Math.max(60, rect.width * 0.4),
    });
  } else {
    const titleWidth = drawText(ctx, vm.toolbar.title, rect.x + padding + 16, rect.y + rect.height / 2 - 7, {
      size: 13,
      weight: 700,
      color: theme.text,
      maxWidth: rect.width * 0.22,
    });
    drawText(
      ctx,
      `${status.label} · ${vm.timeline.label}`,
      rect.x + padding + 16 + titleWidth + 10,
      rect.y + rect.height / 2 - 7,
      { size: 10, weight: 600, color: theme.textMuted, maxWidth: Math.max(40, rect.width * 0.2) },
    );
    drawText(
      ctx,
      vm.toolbar.summary.map((entry) => `${entry.label} ${entry.value}`).join(' · '),
      rect.x + padding + 16,
      rect.y + rect.height / 2 + 8,
      { size: 9.5, weight: 500, color: theme.textFaint, maxWidth: rect.width * 0.4 },
    );
  }

  drawCounters(ctx, rect, vm, theme, add, padding);
  drawActions(ctx, rect, vm, theme, add, padding);
}

function drawCounters(
  ctx: Ctx,
  rect: Rect,
  vm: UptimeViewModel,
  theme: ThemeTokens,
  add: HitCollector,
  padding: number,
): void {
  const counterWidth = 76;
  const actionSpan = (Math.max(10, Math.min(15, rect.height * 0.3)) * 2 + 8) * vm.toolbar.actions.length;
  const countersRight = rect.x + rect.width - padding - actionSpan - 8;
  const available = countersRight - (rect.x + rect.width * (rect.width < 620 ? 0.5 : 0.44));
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
  vm: UptimeViewModel,
  theme: ThemeTokens,
  add: HitCollector,
  padding: number,
): void {
  const radius = Math.max(10, Math.min(15, rect.height * 0.3));
  const gap = radius * 2 + 8;
  const right = rect.x + rect.width - padding;

  vm.toolbar.actions.forEach((action, index) => {
    const cx = right - radius - index * gap;
    if (cx - radius < rect.x + rect.width * 0.5) return;
    const cy = rect.y + rect.height / 2;
    ctx.globalAlpha = action.disabled ? 0.42 : 1;
    drawIconButton(ctx, {
      cx,
      cy,
      radius,
      icon: ACTION_ICON_CYCLE[index % ACTION_ICON_CYCLE.length]!,
      theme,
      ...(action.active ? { accent: theme.status.warning } : {}),
    });
    ctx.globalAlpha = 1;
    if (!action.disabled) {
      add({
        id: `action-${action.id}`,
        rect: { x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2 },
        shape: 'circle',
        radius: radius * 1.15,
        tooltip: action.label,
        action: action.id,
      });
    }
  });
}

/** State chips (with counts), group chips and the heatmap legend. */
export function drawFilters(
  ctx: Ctx,
  rect: Rect,
  vm: UptimeViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme, 12);
  const padding = 12;
  const chipHeight = Math.max(20, Math.min(26, rect.height * 0.5));
  const top = rect.y + (rect.height - chipHeight) / 2;
  const maxX = rect.x + rect.width - padding;
  let cursor = rect.x + padding;

  for (const chip of vm.filters.states) {
    const label = chip.state === 'all' ? chip.label : `${chip.label} ${chip.count}`;
    const width = Math.max(chipHeight + 10, ctx.measureText(label).width + 24);
    if (cursor + width > maxX) break;
    drawChipRect(ctx, { x: cursor, y: top, width, height: chipHeight }, label, chip.color, chip.active, theme);
    add({
      id: `filter-state-${chip.state}`,
      rect: { x: cursor, y: top, width, height: chipHeight },
      tooltip: `${chip.label} · ${chip.count}`,
      action: `filter-state:${chip.state}`,
    });
    cursor += width + 6;
  }

  cursor += 4;
  for (const chip of vm.filters.groups) {
    const label = `${chip.group} ${chip.count}`;
    const width = Math.max(chipHeight + 10, ctx.measureText(label).width + 24);
    if (cursor + width > maxX) break;
    drawChipRect(
      ctx,
      { x: cursor, y: top, width, height: chipHeight },
      label,
      chip.color,
      chip.active,
      theme,
      chip.impacted > 0,
    );
    add({
      id: `filter-group-${chip.group}`,
      rect: { x: cursor, y: top, width, height: chipHeight },
      tooltip: `${chip.group} · ${chip.count} services${chip.impacted > 0 ? ` · ${chip.impacted} impacted` : ''}`,
      action: `filter-group:${chip.group}`,
    });
    cursor += width + 6;
  }

  // Legend, right aligned, when there is room for it.
  const legendWidth = vm.timeline.legend.length * 78;
  if (cursor + legendWidth < maxX) {
    let legendX = maxX - legendWidth;
    for (const entry of vm.timeline.legend) {
      ctx.beginPath();
      roundRectPath(ctx, legendX, rect.y + rect.height / 2 - 4, 8, 8, 2);
      ctx.fillStyle = entry.color;
      ctx.fill();
      drawText(ctx, entry.label, legendX + 12, rect.y + rect.height / 2, {
        size: 9,
        weight: 600,
        color: theme.textFaint,
        maxWidth: 64,
      });
      legendX += 78;
    }
  }
}

function drawChipRect(
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

