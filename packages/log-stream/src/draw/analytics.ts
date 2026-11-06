import { LOG_LEVELS, formatPercent, withAlpha, type LogLevel, type ThemeTokens } from '@widgets/core';
import {
  drawChip,
  drawPanel,
  drawProgressBar,
  drawText,
  roundRectPath,
  wrapText,
  type Ctx,
  type HitCollector,
  type Rect,
} from '@widgets/render';
import { timeLabel, type LogViewModel } from '../view-model';

/** Analytics + inspector sections: volume histogram, service breakdown, detail. */

export function drawHistogram(
  ctx: Ctx,
  rect: Rect,
  vm: LogViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme);
  const padding = 14;
  drawText(ctx, 'Volume by severity', rect.x + padding, rect.y + 17, {
    size: 12,
    weight: 700,
    color: theme.text,
  });
  drawText(ctx, vm.histogram.spanLabel, rect.x + rect.width - padding, rect.y + 17, {
    size: 9.5,
    weight: 600,
    color: theme.textFaint,
    align: 'right',
    maxWidth: rect.width * 0.55,
  });

  const plot = {
    x: rect.x + padding,
    y: rect.y + 30,
    width: Math.max(10, rect.width - padding * 2),
    height: Math.max(10, rect.height - 30 - 24),
  };

  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y + plot.height);
  ctx.lineTo(plot.x + plot.width, plot.y + plot.height);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  const buckets = vm.histogram.buckets;
  if (buckets.length === 0) return;
  const slot = plot.width / buckets.length;
  const barWidth = Math.max(2, slot * 0.62);

  buckets.forEach((bucket, index) => {
    const x = plot.x + slot * index + (slot - barWidth) / 2;
    let cursorY = plot.y + plot.height;
    // Most severe level sits at the top of each stack.
    for (const level of [...LOG_LEVELS].reverse()) {
      const count = bucket.counts[level];
      if (count <= 0) continue;
      const height = (count / vm.histogram.max) * plot.height;
      if (height < 0.6) continue;
      cursorY -= height;
      ctx.beginPath();
      roundRectPath(ctx, x, cursorY, barWidth, height, Math.min(3, barWidth / 2));
      ctx.fillStyle = vm.histogram.colors[level as LogLevel];
      ctx.fill();
    }
    if (bucket.total > 0) {
      add({
        id: `bucket-${index}`,
        rect: { x: plot.x + slot * index, y: plot.y, width: slot, height: plot.height },
        tooltip: `${timeLabel(bucket.t)} · ${bucket.total} lines (${LOG_LEVELS.filter(
          (level) => bucket.counts[level] > 0,
        )
          .map((level) => `${level} ${bucket.counts[level]}`)
          .join(', ')})`,
        payload: { bucket: index, total: bucket.total },
      });
    }
  });

  drawText(ctx, `-${buckets.length}s`, plot.x, plot.y + plot.height + 12, {
    size: 9,
    weight: 600,
    color: theme.textFaint,
  });
  drawText(ctx, 'now', plot.x + plot.width, plot.y + plot.height + 12, {
    size: 9,
    weight: 600,
    color: theme.textFaint,
    align: 'right',
  });
}

export function drawServices(
  ctx: Ctx,
  rect: Rect,
  vm: LogViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme);
  const padding = 14;
  drawText(ctx, 'Services', rect.x + padding, rect.y + 17, {
    size: 12,
    weight: 700,
    color: theme.text,
  });
  drawText(ctx, 'share of buffered lines', rect.x + rect.width - padding, rect.y + 17, {
    size: 9.5,
    weight: 600,
    color: theme.textFaint,
    align: 'right',
    maxWidth: rect.width * 0.6,
  });

  const items = vm.services;
  if (items.length === 0) {
    drawText(ctx, '—', rect.x + rect.width / 2, rect.y + rect.height / 2, {
      size: 11,
      color: theme.textFaint,
      align: 'center',
    });
    return;
  }

  const rowHeight = (rect.height - 34) / items.length;
  items.forEach((item, index) => {
    const rowY = rect.y + 30 + rowHeight * index;
    drawText(ctx, item.service, rect.x + padding, rowY + rowHeight * 0.3, {
      size: 10.5,
      weight: 600,
      color: theme.text,
      maxWidth: rect.width - padding * 2 - 62,
    });
    drawChip(
      ctx,
      rect.x + rect.width - padding,
      rowY + rowHeight * 0.16,
      item.errorCount > 0 ? `${item.count} · ${item.errorCount} err` : String(item.count),
      item.errorCount > 0 ? theme.status[item.tone === 'critical' ? 'critical' : 'warning'] : item.color,
      theme,
      { align: 'right', height: 17, fontSize: 10 },
    );
    drawProgressBar(ctx, {
      rect: {
        x: rect.x + padding,
        y: rowY + rowHeight * 0.58,
        width: rect.width - padding * 2,
        height: 7,
      },
      value: item.percent,
      color: item.color,
      track: theme.track,
      secondaryValue: Math.min(40, item.errorPercent * 0.5),
      secondaryColor: withAlpha(theme.status.critical, 0.8),
      radius: 3.5,
    });
    add({
      id: `service-${item.service}`,
      rect: { x: rect.x, y: rowY, width: rect.width, height: rowHeight },
      tooltip: `${item.service} · ${item.count} lines · ${formatPercent(item.errorPercent, 1)} errors`,
      action: `filter-service:${item.service}`,
    });
  });
}


export function drawDetail(
  ctx: Ctx,
  rect: Rect,
  vm: LogViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme);
  const padding = 14;
  const detail = vm.detail;

  drawText(ctx, detail.title, rect.x + padding, rect.y + 17, {
    size: 12,
    weight: 700,
    color: theme.text,
  });

  if (!detail.entry) {
    drawText(ctx, detail.subtitle, rect.x + padding, rect.y + 44, {
      size: 10.5,
      weight: 500,
      color: theme.textFaint,
      maxWidth: rect.width - padding * 2,
    });
    return;
  }

  drawChip(ctx, rect.x + rect.width - padding, rect.y + 8, detail.entry.level.toUpperCase(), theme.levels[detail.entry.level], theme, {
    align: 'right',
    height: 18,
    fontSize: 10,
  });
  add({
    id: 'detail-copy',
    rect: { x: rect.x + rect.width - padding - 56, y: rect.y + 6, width: 56, height: 24 },
    tooltip: 'Copy line',
    action: 'copy',
    payload: { id: detail.entry.id },
  });

  let cursor = rect.y + 38;
  drawText(ctx, detail.subtitle, rect.x + padding, cursor, {
    size: 10,
    weight: 600,
    color: theme.textMuted,
    maxWidth: rect.width - padding * 2,
  });
  cursor += 18;

  // Message block, wrapped to the panel width.
  const messageLines = wrapText(ctx, detail.entry.message, rect.width - padding * 2 - 16, {
    size: 11.5,
    maxLines: 6,
  });
  const messageHeight = messageLines.length * 15 + 12;
  ctx.beginPath();
  roundRectPath(ctx, rect.x + padding, cursor, rect.width - padding * 2, messageHeight, 8);
  ctx.fillStyle = withAlpha('#000000', theme.name === 'dark' ? 0.22 : 0.04);
  ctx.fill();
  messageLines.forEach((line, index) => {
    drawText(ctx, line, rect.x + padding + 8, cursor + 12 + index * 15, {
      size: 11.5,
      weight: 500,
      color: theme.text,
      maxWidth: rect.width - padding * 2 - 16,
    });
  });
  cursor += messageHeight + 10;

  for (const row of detail.rows) {
    if (cursor > rect.y + rect.height - 14) break;
    drawText(ctx, row.label.toUpperCase(), rect.x + padding, cursor, {
      size: 8.5,
      weight: 700,
      color: theme.textFaint,
      maxWidth: 60,
    });
    drawText(ctx, row.value, rect.x + padding + 62, cursor, {
      size: 10.5,
      weight: 600,
      color: theme.text,
      maxWidth: rect.width - padding * 2 - 62,
    });
    cursor += 16;
  }

  // Attributes as inline label=value chips.
  let chipX = rect.x + padding;
  const chipTop = cursor + 4;
  for (const attribute of detail.attributes) {
    const label = `${attribute.label}=${attribute.value}`;
    const width = Math.min(rect.width - padding * 2, ctx.measureText(label).width + 20);
    if (chipTop + 20 > rect.y + rect.height - 6) break;
    if (chipX + width > rect.x + rect.width - padding) break;
    ctx.beginPath();
    roundRectPath(ctx, chipX, chipTop, width, 18, 5);
    ctx.fillStyle = theme.surfaceRaised;
    ctx.fill();
    drawText(ctx, label, chipX + 8, chipTop + 9, {
      size: 9.5,
      weight: 600,
      color: theme.textMuted,
      maxWidth: width - 14,
    });
    chipX += width + 6;
  }
}

