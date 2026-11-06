import { formatBytes, formatUptime, withAlpha, type ThemeTokens } from '@widgets/core';
import {
  drawChip,
  drawPanel,
  drawProgressBar,
  drawStatusDot,
  drawText,
  roundRectPath,
  wrapText,
  type Ctx,
  type HitCollector,
  type Rect,
} from '@widgets/render';
import { drawSparkline } from './cards';
import type { ContainerGridViewModel } from '../view-model';

/** Inspector for the selected workload: status, resources, metadata and labels. */

export function drawDetail(
  ctx: Ctx,
  rect: Rect,
  vm: ContainerGridViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme, 12);
  const padding = 14;
  const detail = vm.detail;

  drawText(ctx, detail.title, rect.x + padding, rect.y + 17, {
    size: 12,
    weight: 700,
    color: theme.text,
    maxWidth: rect.width - padding * 2 - 80,
  });

  if (!detail.container) {
    drawText(ctx, detail.subtitle, rect.x + padding, rect.y + 44, {
      size: 10.5,
      weight: 500,
      color: theme.textFaint,
      maxWidth: rect.width - padding * 2,
    });
    return;
  }

  drawChip(ctx, rect.x + rect.width - padding, rect.y + 8, detail.statusLabel.toUpperCase(), detail.statusColor, theme, {
    align: 'right',
    height: 18,
    fontSize: 10,
  });
  add({
    id: 'detail-copy',
    rect: { x: rect.x + rect.width - padding - 58, y: rect.y + 6, width: 58, height: 24 },
    tooltip: 'Copy workload state',
    action: 'copy',
    payload: { id: detail.container.id },
  });

  const container = detail.container;
  let cursor = rect.y + 36;
  drawText(ctx, `${container.namespace} · ${container.workload ?? 'standalone'}`, rect.x + padding, cursor, {
    size: 10,
    weight: 600,
    color: theme.textMuted,
    maxWidth: rect.width - padding * 2,
  });
  cursor += 20;

  // Resource summary box.
  const boxHeight = 62;
  ctx.beginPath();
  roundRectPath(ctx, rect.x + padding, cursor, rect.width - padding * 2, boxHeight, 8);
  ctx.fillStyle = withAlpha('#000000', theme.name === 'dark' ? 0.2 : 0.03);
  ctx.fill();

  drawStatusDot(ctx, rect.x + padding + 12, cursor + 16, 3, container.health, theme);
  drawText(ctx, `cpu ${container.cpu.used.toFixed(2)}${container.cpu.limit ? ` / ${container.cpu.limit.toFixed(2)}` : ''}`, rect.x + padding + 22, cursor + 16, {
    size: 10,
    weight: 600,
    color: theme.text,
    maxWidth: rect.width - padding * 2 - 40,
  });
  drawProgressBar(ctx, {
    rect: { x: rect.x + padding + 10, y: cursor + 26, width: rect.width - padding * 2 - 20, height: 6 },
    value: container.cpu.percent ?? 0,
    color: theme.accents[0]!,
    track: theme.track,
    radius: 3,
  });
  drawText(
    ctx,
    `mem ${formatBytes(container.memory.used)}${container.memory.limit ? ` / ${formatBytes(container.memory.limit)}` : ''}`,
    rect.x + padding + 10,
    cursor + 46,
    { size: 10, weight: 600, color: theme.text, maxWidth: rect.width - padding * 2 - 20 },
  );
  drawProgressBar(ctx, {
    rect: { x: rect.x + padding + 10, y: cursor + 52, width: rect.width - padding * 2 - 20, height: 6 },
    value: container.memory.percent ?? 0,
    color: theme.accents[1]!,
    track: theme.track,
    radius: 3,
  });
  cursor += boxHeight + 10;

  // CPU sparkline from the store history.
  const spark = vm.detail.spark;
  if (spark.length > 1 && cursor + 26 < rect.y + rect.height - 30) {
    drawText(ctx, 'CPU history', rect.x + padding, cursor + 4, { size: 9, weight: 700, color: theme.textFaint });
    drawSparkline(
      ctx,
      { x: rect.x + padding + 66, y: cursor - 4, width: rect.width - padding * 2 - 66, height: 22 },
      spark.map((value) => (container.cpu.limit ? Math.min(100, (value / container.cpu.limit) * 100) : 0)),
      detail.statusColor,
      theme,
    );
    cursor += 28;
  }

  // Key/value rows.
  for (const row of vm.detail.rows) {
    if (cursor > rect.y + rect.height - 30) break;
    drawText(ctx, row.label.toUpperCase(), rect.x + padding, cursor, {
      size: 8.5,
      weight: 700,
      color: theme.textFaint,
      maxWidth: 62,
    });
    drawText(ctx, row.value, rect.x + padding + 66, cursor, {
      size: 10.5,
      weight: 600,
      color: theme.text,
      maxWidth: rect.width - padding * 2 - 66,
    });
    cursor += 16;
  }

  // Labels as chips, plus the last message when there is room.
  let chipX = rect.x + padding;
  const chipTop = cursor + 4;
  for (const label of vm.detail.labels) {
    const text = `${label.label}=${label.value}`;
    const width = Math.min(rect.width - padding * 2, ctx.measureText(text).width + 20);
    if (chipTop + 20 > rect.y + rect.height - 6 || chipX + width > rect.x + rect.width - padding) break;
    ctx.beginPath();
    roundRectPath(ctx, chipX, chipTop, width, 18, 5);
    ctx.fillStyle = theme.surfaceRaised;
    ctx.fill();
    drawText(ctx, text, chipX + 8, chipTop + 9, {
      size: 9.5,
      weight: 600,
      color: theme.textMuted,
      maxWidth: width - 14,
    });
    chipX += width + 6;
  }

  if (container.message) {
    const lines = wrapText(ctx, container.message, rect.width - padding * 2, { size: 10, maxLines: 2 });
    const top = rect.y + rect.height - 26;
    lines.forEach((line, index) => {
      drawText(ctx, line, rect.x + padding, top + index * 13, {
        size: 10,
        weight: 500,
        color: withAlpha(detail.statusColor, 0.95),
        maxWidth: rect.width - padding * 2,
      });
    });
  }

  drawText(
    ctx,
    `age ${container.startedAt ? formatUptime(Math.max(0, Date.now() - container.startedAt) / 1000) : '—'}`,
    rect.x + rect.width - padding,
    rect.y + rect.height - 12,
    { size: 9.5, weight: 600, color: theme.textFaint, align: 'right', maxWidth: 90 },
  );
}
