import { withAlpha, type ThemeTokens } from '@widgets/core';
import {
  drawIconButton,
  drawPanel,
  drawProgressBar,
  drawStatusDot,
  drawText,
  roundRectPath,
  type Ctx,
  type HitCollector,
  type Rect,
} from '@widgets/render';
import type { ContainerGridViewModel } from '../view-model';

/** Chrome of the container grid: toolbar, filter strip, capacity and namespace rollups. */

const ACTION_ICON_CYCLE = ['alert', 'network', 'logs', 'link'] as const;

export function drawToolbar(
  ctx: Ctx,
  rect: Rect,
  vm: ContainerGridViewModel,
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
    maxWidth: rect.width * 0.24,
  });
  drawText(
    ctx,
    `${status.label} · ${vm.cards.label}`,
    rect.x + padding + 16 + titleWidth + 10,
    rect.y + rect.height / 2 - 7,
    { size: 10, weight: 600, color: theme.textMuted, maxWidth: Math.max(40, rect.width * 0.2) },
  );
  drawText(ctx, status.description, rect.x + padding + 16, rect.y + rect.height / 2 + 8, {
    size: 9.5,
    weight: 500,
    color: theme.textFaint,
    maxWidth: rect.width * 0.42,
  });

  drawCounters(ctx, rect, vm, theme, add, padding);
  drawActions(ctx, rect, vm, theme, add, padding);
}

function drawCounters(
  ctx: Ctx,
  rect: Rect,
  vm: ContainerGridViewModel,
  theme: ThemeTokens,
  add: HitCollector,
  padding: number,
): void {
  const counterWidth = 60;
  const actionSpan = (Math.max(10, Math.min(15, rect.height * 0.3)) * 2 + 8) * vm.toolbar.actions.length;
  const countersRight = rect.x + rect.width - padding - actionSpan - 8;
  const available = countersRight - (rect.x + rect.width * 0.44);
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
  vm: ContainerGridViewModel,
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
      ...(action.id === 'reset' ? { iconColor: theme.status.critical } : {}),
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

/** Phase chips (with counts) + namespace chips (with critical badges). */
export function drawFilters(
  ctx: Ctx,
  rect: Rect,
  vm: ContainerGridViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme, 12);
  const padding = 12;
  const chipHeight = Math.max(20, Math.min(26, rect.height * 0.5));
  const top = rect.y + (rect.height - chipHeight) / 2;
  const maxX = rect.x + rect.width - padding;
  let cursor = rect.x + padding;

  for (const chip of vm.filters.phases) {
    const label = `${chip.label} ${chip.count}`;
    const width = Math.max(chipHeight + 10, ctx.measureText(label).width + 24);
    if (cursor + width > maxX) break;
    drawFilterChip(
      ctx,
      { x: cursor, y: top, width, height: chipHeight },
      label,
      chipColor(chip.phase, theme),
      chip.active,
      theme,
    );
    add({
      id: `filter-phase-${chip.phase}`,
      rect: { x: cursor, y: top, width, height: chipHeight },
      tooltip: `${chip.label} · ${chip.count}`,
      action: `filter-phase:${chip.phase}`,
    });
    cursor += width + 6;
  }

  cursor += 4;
  for (const chip of vm.filters.namespaces) {
    const label = `${chip.namespace} ${chip.count}`;
    const width = Math.max(chipHeight + 10, ctx.measureText(label).width + 24);
    if (cursor + width > maxX) break;
    drawFilterChip(
      ctx,
      { x: cursor, y: top, width, height: chipHeight },
      label,
      chip.color,
      chip.active,
      theme,
      chip.critical > 0,
    );
    add({
      id: `filter-namespace-${chip.namespace}`,
      rect: { x: cursor, y: top, width, height: chipHeight },
      tooltip: `${chip.namespace} · ${chip.count} workloads${chip.critical > 0 ? ` · ${chip.critical} critical` : ''}`,
      action: `filter-namespace:${chip.namespace}`,
    });
    cursor += width + 6;
  }
}

function chipColor(phase: string, theme: ThemeTokens): string {
  if (phase === 'running') return theme.status.ok;
  if (phase === 'pending') return theme.status.warning;
  if (phase === 'failed') return theme.status.critical;
  return theme.textMuted;
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


/** Aggregate CPU / memory usage against limits, with the top consumers ranked. */
export function drawCapacity(
  ctx: Ctx,
  rect: Rect,
  vm: ContainerGridViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme, 12);
  const padding = 14;
  drawText(ctx, 'Capacity', rect.x + padding, rect.y + 17, { size: 12, weight: 700, color: theme.text });
  drawText(ctx, 'used vs limits', rect.x + rect.width - padding, rect.y + 17, {
    size: 9.5,
    weight: 600,
    color: theme.textFaint,
    align: 'right',
    maxWidth: rect.width * 0.5,
  });

  const metrics = vm.capacity;
  if (metrics.length === 0) return;
  const blockHeight = Math.max(46, Math.min(66, (rect.height - 34) / metrics.length));
  let cursor = rect.y + 30;

  for (const metric of metrics) {
    const toneColor =
      metric.tone === 'critical'
        ? theme.status.critical
        : metric.tone === 'warning'
          ? theme.status.warning
          : theme.status.ok;
    drawText(ctx, metric.label, rect.x + padding, cursor, { size: 10, weight: 700, color: theme.textMuted });
    drawText(ctx, `${metric.usedLabel} / ${metric.limitLabel}`, rect.x + rect.width - padding, cursor, {
      size: 10,
      weight: 600,
      color: theme.text,
      align: 'right',
      maxWidth: rect.width * 0.6,
    });
    drawProgressBar(ctx, {
      rect: { x: rect.x + padding, y: cursor + 8, width: rect.width - padding * 2, height: 7 },
      value: metric.percent,
      color: metric.color,
      track: theme.track,
      radius: 3.5,
    });
    drawText(ctx, `${metric.percent.toFixed(0)}%`, rect.x + padding, cursor + 22, {
      size: 9,
      weight: 700,
      color: toneColor,
    });
    // Ranked consumers for this metric.
    const consumerTop = cursor + 34;
    const rowHeight = 15;
    metric.consumers.slice(0, 3).forEach((consumer, index) => {
      const y = consumerTop + rowHeight * index;
      if (y > rect.y + rect.height - 8) return;
      ctx.beginPath();
      ctx.arc(rect.x + padding + 3, y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = consumer.color;
      ctx.fill();
      drawText(ctx, consumer.name, rect.x + padding + 10, y, {
        size: 9.5,
        weight: 600,
        color: theme.text,
        maxWidth: rect.width * 0.5,
      });
      drawText(ctx, consumer.label, rect.x + rect.width - padding, y, {
        size: 9.5,
        weight: 600,
        color: theme.textMuted,
        align: 'right',
        maxWidth: rect.width * 0.4,
      });
    });
    cursor = consumerTop + rowHeight * 3 + 6;
  }

  add({
    id: 'capacity',
    rect,
    tooltip: `${vm.cards.filteredTotal} workloads · ${vm.capacity[0]?.usedLabel ?? ''} CPU`,
  });
}

/** Namespace breakdown with counts and critical markers. */
export function drawNamespaces(
  ctx: Ctx,
  rect: Rect,
  vm: ContainerGridViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme, 12);
  const padding = 14;
  drawText(ctx, 'Namespaces', rect.x + padding, rect.y + 17, { size: 12, weight: 700, color: theme.text });
  drawText(ctx, 'workloads', rect.x + rect.width - padding, rect.y + 17, {
    size: 9.5,
    weight: 600,
    color: theme.textFaint,
    align: 'right',
    maxWidth: rect.width * 0.5,
  });

  const rows = vm.namespaces;
  if (rows.length === 0) {
    drawText(ctx, '—', rect.x + rect.width / 2, rect.y + rect.height / 2, {
      size: 11,
      color: theme.textFaint,
      align: 'center',
    });
    return;
  }

  const rowHeight = (rect.height - 34) / rows.length;
  rows.forEach((row, index) => {
    const rowY = rect.y + 28 + rowHeight * index;
    ctx.beginPath();
    ctx.arc(rect.x + padding + 3, rowY + rowHeight * 0.34, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = row.critical > 0 ? theme.status.critical : row.color;
    ctx.fill();
    drawText(ctx, row.namespace, rect.x + padding + 12, rowY + rowHeight * 0.34, {
      size: 10,
      weight: 600,
      color: theme.text,
      maxWidth: rect.width - padding * 2 - 80,
    });
    drawText(
      ctx,
      row.critical > 0 ? `${row.count} · ${row.critical} crit` : String(row.count),
      rect.x + rect.width - padding,
      rowY + rowHeight * 0.34,
      {
        size: 9.5,
        weight: 700,
        color: row.critical > 0 ? theme.status.critical : theme.textMuted,
        align: 'right',
        maxWidth: 76,
      },
    );
    drawProgressBar(ctx, {
      rect: { x: rect.x + padding, y: rowY + rowHeight * 0.62, width: rect.width - padding * 2, height: 6 },
      value: row.percent,
      color: row.color,
      track: theme.track,
      radius: 3,
    });
    add({
      id: `namespace-${row.namespace}`,
      rect: { x: rect.x, y: rowY, width: rect.width, height: rowHeight },
      tooltip: `${row.namespace} · ${row.count} workloads · ${percentLabel(row.count, vm.cards.filteredTotal ? row.count : 0)}`,
      action: `filter-namespace:${row.namespace}`,
    });
  });
}

function percentLabel(count: number, total: number): string {
  if (total <= 0) return '—';
  return `${Math.round((count / total) * 100)}%`;
}

