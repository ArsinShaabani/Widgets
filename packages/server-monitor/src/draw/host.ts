import { formatPercent, withAlpha, type ThemeTokens } from '@widgets/core';
import { roundRectPath, type Rect } from '../geometry';
import type { HitCollector } from '../hit';
import type { ViewModel } from '../view-model';
import {
  drawChip,
  drawIconButton,
  drawPanel,
  drawProgressBar,
  drawRings,
  drawText,
  type Ctx,
} from './primitives';

/** Sections of the host column: identity card, status badges, resource lists. */

export function drawHost(ctx: Ctx, rect: Rect, vm: ViewModel, theme: ThemeTokens, add: HitCollector): void {
  drawPanel(ctx, rect, theme);
  const padding = 16;
  const avatarRadius = Math.min(28, Math.max(16, rect.width * 0.075));
  const avatarCx = rect.x + padding + avatarRadius;
  const avatarCy = rect.y + padding + avatarRadius;

  ctx.beginPath();
  ctx.arc(avatarCx, avatarCy, avatarRadius, 0, Math.PI * 2);
  ctx.fillStyle = theme.surfaceRaised;
  ctx.fill();
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  drawText(ctx, vm.host.initials, avatarCx, avatarCy + 1, {
    size: Math.max(12, avatarRadius * 0.68),
    weight: 800,
    color: theme.text,
    align: 'center',
  });

  if (vm.alertCount > 0) {
    const badgeRadius = Math.max(8, avatarRadius * 0.36);
    const bx = avatarCx + avatarRadius * 0.72;
    const by = avatarCy - avatarRadius * 0.72;
    ctx.beginPath();
    ctx.arc(bx, by, badgeRadius, 0, Math.PI * 2);
    ctx.fillStyle = theme.badge;
    ctx.fill();
    drawText(ctx, String(vm.alertCount), bx, by + 0.5, {
      size: badgeRadius * 1.05,
      weight: 800,
      color: '#ffffff',
      align: 'center',
    });
    add({
      id: 'host-alerts',
      rect: { x: bx - badgeRadius, y: by - badgeRadius, width: badgeRadius * 2, height: badgeRadius * 2 },
      shape: 'circle',
      radius: badgeRadius * 1.35,
      tooltip: vm.alerts.map((alert) => alert.title).join(' · ') || 'Alerts',
      action: 'alerts',
      payload: { alerts: vm.alerts },
    });
  }

  const textLeft = avatarCx + avatarRadius + 12;
  const scoreBoxWidth = Math.min(140, rect.width * 0.36);
  const nameWidth = rect.width - (textLeft - rect.x) - scoreBoxWidth - padding - 8;

  drawText(ctx, vm.host.name, textLeft, rect.y + padding + avatarRadius * 0.62, {
    size: Math.min(19, Math.max(13, rect.width * 0.045)),
    weight: 700,
    color: theme.text,
    maxWidth: Math.max(40, nameWidth),
  });
  drawText(ctx, `${vm.host.os} · ${vm.host.region}`, textLeft, rect.y + padding + avatarRadius * 1.5, {
    size: 10.5,
    weight: 500,
    color: theme.textMuted,
    maxWidth: Math.max(40, nameWidth),
  });

  drawScoreBox(ctx, rect, vm, theme, scoreBoxWidth, padding);

  let barY = rect.y + padding + avatarRadius * 2 + 14;
  const barWidth = rect.width - padding * 2;
  for (const bar of vm.hostBars) {
    drawText(ctx, bar.label, rect.x + padding, barY + 4, {
      size: 10,
      weight: 600,
      color: theme.textMuted,
      maxWidth: barWidth - 50,
    });
    drawText(ctx, bar.valueLabel, rect.x + rect.width - padding, barY + 4, {
      size: 10.5,
      weight: 700,
      color: theme.text,
      align: 'right',
    });
    drawProgressBar(ctx, {
      rect: { x: rect.x + padding, y: barY + 14, width: barWidth, height: 6 },
      value: bar.value,
      color: bar.color,
      track: theme.track,
      radius: 3,
    });
    barY += 30;
  }

  drawDetailBox(ctx, { x: rect.x, y: barY + 2, width: rect.width, height: rect.y + rect.height - padding - (barY + 2) }, vm, theme, padding);

  add({
    id: 'host-card',
    rect,
    tooltip: `${vm.host.name} · ${vm.host.os} · up ${vm.host.uptimeLabel}`,
    action: 'host',
    payload: { name: vm.host.name, status: vm.status },
  });
}

/** Health / processes / uptime scoreboard in the top-right of the host card. */
function drawScoreBox(
  ctx: Ctx,
  rect: Rect,
  vm: ViewModel,
  theme: ThemeTokens,
  width: number,
  padding: number,
): void {
  const height = Math.max(46, Math.min(62, rect.height * 0.22));
  const x = rect.x + rect.width - padding - width;
  const y = rect.y + padding * 0.6;
  ctx.beginPath();
  roundRectPath(ctx, x, y, width, height, 8);
  ctx.fillStyle = withAlpha(theme.text, 0.04);
  ctx.fill();
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  const cells: Array<{ value: string; label: string; color?: string }> = vm.pending
    ? [
        { value: '—', label: 'health' },
        { value: '—', label: 'procs' },
        { value: '—', label: 'alerts' },
      ]
    : [
        { value: String(vm.score.health), label: `health ${vm.score.grade}`, color: theme.status[vm.status] },
        { value: String(vm.score.processes), label: 'procs' },
        { value: String(vm.alertCount), label: 'alerts', color: vm.alertCount > 0 ? theme.badge : theme.status.ok },
      ];
  const cellWidth = width / cells.length;
  cells.forEach((cell, index) => {
    const cx = x + cellWidth * index + cellWidth / 2;
    drawText(ctx, cell.value, cx, y + height * 0.38, {
      size: Math.max(12, height * 0.3),
      weight: 800,
      color: cell.color ?? theme.text,
      align: 'center',
    });
    drawText(ctx, cell.label, cx, y + height * 0.74, {
      size: 8.5,
      weight: 600,
      color: theme.textFaint,
      align: 'center',
      maxWidth: cellWidth - 6,
    });
    if (index > 0) {
      ctx.beginPath();
      ctx.moveTo(x + cellWidth * index, y + height * 0.22);
      ctx.lineTo(x + cellWidth * index, y + height * 0.78);
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  });
}

/** Bordered key/value grid (OS, IP, region, latency). */
function drawDetailBox(
  ctx: Ctx,
  box: Rect,
  vm: ViewModel,
  theme: ThemeTokens,
  padding: number,
): void {
  if (box.height <= 34 || vm.details.length === 0) return;
  const innerWidth = box.width - padding * 2;
  ctx.beginPath();
  roundRectPath(ctx, box.x + padding, box.y, innerWidth, box.height, 8);
  ctx.fillStyle = withAlpha(theme.text, 0.03);
  ctx.fill();
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  const rows = Math.max(1, Math.ceil(vm.details.length / 2));
  const rowHeight = box.height / rows;
  const cellWidth = innerWidth / 2;
  vm.details.forEach((detail, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const cellX = box.x + padding + 10 + column * cellWidth;
    const cellY = box.y + rowHeight * row + rowHeight / 2;
    drawText(ctx, detail.label.toUpperCase(), cellX, cellY - 6, {
      size: 8.5,
      weight: 700,
      color: theme.textFaint,
      maxWidth: cellWidth - 18,
    });
    drawText(ctx, detail.value, cellX, cellY + 6, {
      size: 10.5,
      weight: 600,
      color: theme.text,
      maxWidth: cellWidth - 18,
    });
  });
}

/** 01/02/03 status rings for CPU / memory / disk with a status colour. */
export function drawBadges(ctx: Ctx, rect: Rect, vm: ViewModel, theme: ThemeTokens, add: HitCollector): void {
  const badges = vm.badges;
  const slotWidth = rect.width / Math.max(1, badges.length);
  const radius = Math.max(16, Math.min(slotWidth * 0.3, (rect.height - 34) * 0.44));

  badges.forEach((badge, index) => {
    const cx = rect.x + slotWidth * index + slotWidth / 2;
    const cy = rect.y + radius + 6;
    const accent = theme.status[badge.status] ?? theme.status.unknown;
    drawRings(ctx, cx, cy, radius, theme, accent, badge.status === 'unknown' ? 0.15 : 1);
    drawText(ctx, badge.value, cx, cy + 1, {
      size: Math.max(11, radius * 0.52),
      weight: 700,
      color: theme.text,
      align: 'center',
    });
    drawText(ctx, badge.label, cx, cy + radius + 15, {
      size: 10,
      weight: 600,
      color: theme.textMuted,
      align: 'center',
      maxWidth: slotWidth - 6,
    });
    add({
      id: `badge-${badge.id}`,
      rect: { x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2 },
      shape: 'circle',
      radius: radius * 1.12,
      tooltip: `${badge.label} · ${badge.value} (${badge.status})`,
      action: `focus-${badge.id}`,
      payload: { id: badge.id },
    });
  });
}


/** Top processes as labelled capsule bars with a value chip (design rows 1-3). */
export function drawResourceBars(
  ctx: Ctx,
  rect: Rect,
  vm: ViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  const items = vm.resourceBars;
  if (items.length === 0) {
    drawText(ctx, '—', rect.x + rect.width / 2, rect.y + rect.height / 2, {
      size: 11,
      color: theme.textFaint,
      align: 'center',
    });
    return;
  }
  const rowHeight = rect.height / items.length;
  const barHeight = Math.max(6, Math.min(12, rowHeight * 0.28));

  items.forEach((item, index) => {
    const rowY = rect.y + rowHeight * index;
    const labelY = rowY + rowHeight * 0.24;
    drawText(ctx, item.label, rect.x, labelY, {
      size: 10.5,
      weight: 600,
      color: theme.textMuted,
      maxWidth: rect.width - 60,
    });
    drawChip(ctx, rect.x + rect.width, rowY + rowHeight * 0.1, item.valueLabel, theme.status[item.status], theme, {
      align: 'right',
      height: 18,
    });
    drawProgressBar(ctx, {
      rect: { x: rect.x, y: rowY + rowHeight * 0.55, width: rect.width, height: barHeight },
      value: item.value,
      color: item.color,
      track: theme.track,
      radius: 3,
    });
    add({
      id: `resource-${item.id}`,
      rect: { x: rect.x, y: rowY, width: rect.width, height: rowHeight },
      tooltip: `${item.label} · ${item.valueLabel}`,
      payload: { id: item.id, value: item.value },
    });
  });
}

/** Split metrics (user/system, used/cache, read/write) as dual segment bars. */
export function drawDualBars(
  ctx: Ctx,
  rect: Rect,
  vm: ViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  const items = vm.dualBars;
  if (items.length === 0) {
    drawText(ctx, '—', rect.x + rect.width / 2, rect.y + rect.height / 2, {
      size: 11,
      color: theme.textFaint,
      align: 'center',
    });
    return;
  }
  const rowHeight = rect.height / items.length;

  items.forEach((item, index) => {
    const rowY = rect.y + rowHeight * index;
    const color = item.color ?? theme.accents[0]!;
    const secondaryColor = theme.accents[4]!;

    drawText(ctx, item.label, rect.x, rowY + rowHeight * 0.24, {
      size: 10.5,
      weight: 600,
      color: theme.textMuted,
      maxWidth: rect.width,
    });
    drawChip(
      ctx,
      rect.x,
      rowY + rowHeight * 0.42,
      `${item.primaryLabel} ${formatPercent(item.primary, 0)}`,
      color,
      theme,
      { height: 18 },
    );
    if (item.secondary != null) {
      drawChip(
        ctx,
        rect.x + 92,
        rowY + rowHeight * 0.42,
        `${item.secondaryLabel ?? 'other'} ${formatPercent(item.secondary, 0)}`,
        secondaryColor,
        theme,
        { height: 18 },
      );
    }
    drawProgressBar(ctx, {
      rect: { x: rect.x, y: rowY + rowHeight * 0.78, width: rect.width, height: 8 },
      value: item.primary,
      color,
      track: theme.track,
      secondaryValue: item.secondary ?? 0,
      secondaryColor,
      radius: 4,
    });
    add({
      id: `dual-${item.id}`,
      rect: { x: rect.x, y: rowY, width: rect.width, height: rowHeight },
      tooltip: `${item.label} · ${formatPercent(item.primary, 0)}${
        item.secondary != null ? ` + ${formatPercent(item.secondary, 0)}` : ''
      }`,
      payload: { id: item.id },
    });
  });
}

/** Quick action icon row (settings, logs, share, network, node, dashboard). */
export function drawActions(ctx: Ctx, rect: Rect, vm: ViewModel, theme: ThemeTokens, add: HitCollector): void {
  const actions = vm.actions;
  const slotWidth = rect.width / Math.max(1, actions.length);
  const radius = Math.max(14, Math.min(slotWidth * 0.32, rect.height * 0.34));

  actions.forEach((action, index) => {
    const cx = rect.x + slotWidth * index + slotWidth / 2;
    const cy = rect.y + radius + 2;
    drawIconButton(ctx, {
      cx,
      cy,
      radius,
      icon: action.icon,
      theme,
      accent: index === 0 ? theme.status.ok : undefined,
    });
    drawText(ctx, action.label, cx, cy + radius + 13, {
      size: 9,
      weight: 600,
      color: theme.textMuted,
      align: 'center',
      maxWidth: slotWidth - 2,
    });
    add({
      id: `action-${action.id}`,
      rect: { x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2 },
      shape: 'circle',
      radius: radius * 1.15,
      tooltip: action.label,
      action: action.id,
    });
  });
}

