import { formatBytes, formatPercent, withAlpha, type ThemeTokens } from '@widgets/core';
import {
  capsulePath,
  linearScale,
  monotoneCubicSegments,
  ringSegmentPath,
  seriesToPoints,
  TAU,
  type Rect,
} from '../geometry';
import type { HitCollector } from '../hit';
import type { ViewModel } from '../view-model';
import { barGradient, drawPanel, drawText, traceSmoothPath, type Ctx } from './primitives';

/** Chart sections of the dashboard: per-core bars, donuts, gauges, network area. */

const LABEL_SIZE = 10;

export function drawCpuBars(
  ctx: Ctx,
  rect: Rect,
  vm: ViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme);
  const padding = 16;
  const titleHeight = 34;
  const plot: Rect = {
    x: rect.x + padding + 26,
    y: rect.y + titleHeight,
    width: Math.max(10, rect.width - padding * 2 - 26),
    height: Math.max(10, rect.height - titleHeight - 26),
  };

  drawText(ctx, `CPU · ${vm.cpuBars.cores} cores`, rect.x + padding, rect.y + 20, {
    size: 12.5,
    weight: 700,
    color: theme.text,
    maxWidth: rect.width - padding * 2 - 90,
  });
  drawText(ctx, `avg ${formatPercent(vm.gauges[0]?.value ?? 0, 0)}`, rect.x + rect.width - padding, rect.y + 20, {
    size: 11,
    weight: 600,
    color: theme.textMuted,
    align: 'right',
  });

  const items = vm.cpuBars.items;
  if (items.length === 0) {
    drawText(ctx, '—', plot.x + plot.width / 2, plot.y + plot.height / 2, {
      size: 12,
      color: theme.textFaint,
      align: 'center',
    });
    return;
  }

  const scale = linearScale(0, vm.cpuBars.max, plot.y + plot.height, plot.y);
  for (const tick of [0, vm.cpuBars.max / 2, vm.cpuBars.max]) {
    const y = scale(tick);
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.width, y);
    ctx.strokeStyle = theme.name === 'dark' ? withAlpha('#ffffff', 0.07) : theme.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    drawText(ctx, `${Math.round(tick)}${vm.cpuBars.unit}`, plot.x - 6, y, {
      size: LABEL_SIZE,
      weight: 600,
      color: theme.textFaint,
      align: 'right',
    });
  }

  const slot = plot.width / items.length;
  const barWidth = Math.max(3, Math.min(14, slot * 0.44));
  items.forEach((item, index) => {
    const x = plot.x + slot * index + (slot - barWidth) / 2;
    const y = scale(item.value);
    const height = Math.max(4, plot.y + plot.height - y);
    ctx.beginPath();
    capsulePath(ctx, x, y, barWidth, height);
    ctx.fillStyle = barGradient(ctx, x, y, plot.y + plot.height, theme);
    ctx.fill();
    if (index % 2 === 0 || items.length <= 8) {
      drawText(ctx, item.label, x + barWidth / 2, plot.y + plot.height + 12, {
        size: LABEL_SIZE,
        weight: 600,
        color: theme.textMuted,
        align: 'center',
      });
    }
    add({
      id: `cpu-core-${index}`,
      rect: { x: plot.x + slot * index, y: plot.y, width: slot, height: plot.height + 18 },
      tooltip: item.tooltip,
      payload: { core: index, value: item.value },
    });
  });
}

export function drawDonuts(
  ctx: Ctx,
  rect: Rect,
  vm: ViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme);
  const padding = 14;
  const donuts = vm.donuts;
  const slotWidth = (rect.width - padding * 2) / Math.max(1, donuts.length);
  const radius = Math.max(18, Math.min(slotWidth * 0.33, (rect.height - 62) * 0.32));

  donuts.forEach((donut, index) => {
    const cx = rect.x + padding + slotWidth * index + slotWidth / 2;
    const cy = rect.y + padding + radius + 4;
    const total = donut.segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0) || 1;
    let angle = -Math.PI / 2;

    for (const segment of donut.segments) {
      const sweep = (Math.max(0, segment.value) / total) * TAU;
      if (sweep <= 0.0001) continue;
      ctx.beginPath();
      ringSegmentPath(ctx, cx, cy, radius, radius * 0.55, angle, angle + sweep);
      ctx.fillStyle = segment.color;
      ctx.fill();
      angle += sweep;
    }

    // Inner accent sliver, echoing the design's open donut.
    ctx.beginPath();
    ringSegmentPath(ctx, cx, cy, radius * 0.5, 0, -Math.PI / 2, -Math.PI / 2 + 0.35);
    ctx.fillStyle = withAlpha(theme.text, 0.08);
    ctx.fill();

    drawText(ctx, donut.centerTop, cx, cy - 2, {
      size: Math.max(11, radius * 0.42),
      weight: 700,
      color: theme.text,
      align: 'center',
    });
    drawText(ctx, donut.centerBottom, cx, cy + Math.max(10, radius * 0.34), {
      size: LABEL_SIZE,
      weight: 600,
      color: theme.textMuted,
      align: 'center',
      maxWidth: radius * 1.7,
    });
    drawText(ctx, donut.label, cx, cy + radius + 18, {
      size: 11,
      weight: 700,
      color: theme.text,
      align: 'center',
      maxWidth: slotWidth - 12,
    });
    drawText(ctx, donut.caption, cx, cy + radius + 33, {
      size: LABEL_SIZE,
      weight: 500,
      color: theme.textFaint,
      align: 'center',
      maxWidth: slotWidth - 12,
    });

    const half = slotWidth / 2;
    add({
      id: `donut-${donut.id}`,
      rect: { x: cx - half, y: rect.y + padding, width: half * 2, height: rect.height - padding * 2 },
      tooltip: `${donut.label} · ${donut.segments
        .map((segment) => `${segment.label} ${formatPercent(segment.percent, 0)}`)
        .join(' · ')}`,
      payload: { id: donut.id },
    });
  });
}

export function drawGauges(
  ctx: Ctx,
  rect: Rect,
  vm: ViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme);
  const padding = 14;
  const gauges = vm.gauges;
  const slotWidth = (rect.width - padding * 2) / Math.max(1, gauges.length);
  const radius = Math.max(22, Math.min(slotWidth * 0.3, (rect.height - 54) * 0.4));

  gauges.forEach((gauge, index) => {
    const cx = rect.x + padding + slotWidth * index + slotWidth / 2;
    const cy = rect.y + padding + radius + 2;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.lineWidth = Math.max(5, radius * 0.16);
    ctx.strokeStyle = theme.track;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, gauge.value / 100), false);
    ctx.strokeStyle = gauge.color;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.beginPath();
    ctx.arc(cx, cy, radius - Math.max(7, radius * 0.2), 0, TAU);
    ctx.strokeStyle = theme.name === 'dark' ? withAlpha('#ffffff', 0.55) : theme.textFaint;
    ctx.lineWidth = Math.max(1.5, radius * 0.08);
    ctx.stroke();

    drawText(ctx, gauge.valueLabel, cx, cy + 1, {
      size: Math.max(12, radius * 0.44),
      weight: 700,
      color: theme.text,
      align: 'center',
    });

    drawText(ctx, gauge.index, cx - slotWidth / 2 + 6, cy + radius + 16, {
      size: 15,
      weight: 800,
      color: theme.text,
    });
    drawText(ctx, gauge.caption, cx - slotWidth / 2 + 30, cy + radius + 17, {
      size: LABEL_SIZE + 0.5,
      weight: 600,
      color: theme.textMuted,
      maxWidth: slotWidth - 34,
    });

    add({
      id: `gauge-${gauge.id}`,
      rect: { x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2 },
      shape: 'circle',
      radius: radius * 1.1,
      tooltip: `${gauge.label} · ${formatPercent(gauge.value)}`,
      payload: { id: gauge.id, value: gauge.value, status: gauge.status },
    });
  });
}


export function drawNetwork(
  ctx: Ctx,
  rect: Rect,
  vm: ViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme);
  const padding = 16;
  const titleHeight = 44;
  const plot: Rect = {
    x: rect.x + padding,
    y: rect.y + titleHeight,
    width: Math.max(10, rect.width - padding * 2),
    height: Math.max(10, rect.height - titleHeight - 24),
  };

  drawText(ctx, 'Network', rect.x + padding, rect.y + 18, {
    size: 12.5,
    weight: 700,
    color: theme.text,
  });
  drawText(ctx, vm.connection.description, rect.x + rect.width - padding, rect.y + 18, {
    size: 10.5,
    weight: 600,
    color: theme.textMuted,
    align: 'right',
    maxWidth: rect.width * 0.5,
  });

  const series = vm.network.series;
  if (series.length === 0 || series[0]!.points.length < 2) {
    drawText(ctx, '—', plot.x + plot.width / 2, plot.y + plot.height / 2, {
      size: 12,
      color: theme.textFaint,
      align: 'center',
    });
    return;
  }

  const scaleY = linearScale(0, vm.network.max, plot.y + plot.height, plot.y);
  for (const tick of vm.network.ticks) {
    const y = scaleY(tick);
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.width, y);
    ctx.strokeStyle = theme.name === 'dark' ? withAlpha('#ffffff', 0.06) : theme.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    drawText(ctx, formatBytes(tick, { precision: 0 }), plot.x + plot.width - 2, y + 8, {
      size: 9,
      weight: 600,
      color: theme.name === 'dark' ? theme.textFaint : theme.textMuted,
      align: 'right',
    });
  }

  series.forEach((item, index) => {
    const points = seriesToPoints(item.points, plot, 0, vm.network.max);
    if (points.length < 2) return;
    const segments = monotoneCubicSegments(points);

    ctx.beginPath();
    traceSmoothPath(ctx, segments);
    ctx.lineTo(points[points.length - 1]!.x, plot.y + plot.height);
    ctx.lineTo(points[0]!.x, plot.y + plot.height);
    ctx.closePath();
    if (index === 0) {
      const gradient = ctx.createLinearGradient(plot.x, plot.y, plot.x, plot.y + plot.height);
      gradient.addColorStop(0, withAlpha(theme.areaStroke, 0.5));
      gradient.addColorStop(0.55, withAlpha(theme.areaFill[0], 0.85));
      gradient.addColorStop(1, withAlpha(theme.areaFill[1], 0.95));
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = withAlpha(item.color, 0.16);
    }
    ctx.fill();

    ctx.beginPath();
    traceSmoothPath(ctx, segments);
    ctx.strokeStyle = item.color;
    ctx.lineWidth = index === 0 ? 2.4 : 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();
  });

  let legendX = plot.x;
  for (const item of series) {
    drawText(ctx, '●', legendX, plot.y - 13, { size: 11, color: item.color });
    legendX += 12;
    legendX += drawText(ctx, `${item.label} ${item.valueLabel}`, legendX, plot.y - 13, {
      size: 10.5,
      weight: 600,
      color: theme.textMuted,
    });
    legendX += 16;
    if (legendX > plot.x + plot.width * 0.8) break;
  }

  (['-4m', '-2m', 'now'] as const).forEach((label, index) => {
    drawText(ctx, label, plot.x + (plot.width * index) / 2, plot.y + plot.height + 12, {
      size: 9.5,
      weight: 600,
      color: theme.textMuted,
      align: index === 0 ? 'left' : index === 2 ? 'right' : 'center',
    });
  });

  add({
    id: 'network-chart',
    rect: { x: plot.x, y: rect.y, width: plot.width, height: rect.height },
    tooltip: vm.network.summary,
  });
}

