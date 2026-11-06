import { formatPercent, withAlpha, type ThemeTokens } from '@widgets/core';
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
import { drawSparkline } from '@widgets/render';
import type { UptimeViewModel } from '../view-model';

/** Side stack of the uptime widget: SLO budget, incident log and inspector. */

export function drawSlo(
  ctx: Ctx,
  rect: Rect,
  vm: UptimeViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme);
  const padding = 14;
  drawText(ctx, 'SLO & error budget', rect.x + padding, rect.y + 17, {
    size: 12,
    weight: 700,
    color: theme.text,
  });
  drawText(ctx, 'worst first', rect.x + rect.width - padding, rect.y + 17, {
    size: 9.5,
    weight: 600,
    color: theme.textFaint,
    align: 'right',
    maxWidth: rect.width * 0.5,
  });

  const rows = vm.slo;
  if (rows.length === 0) {
    drawText(ctx, '—', rect.x + rect.width / 2, rect.y + rect.height / 2, {
      size: 11,
      color: theme.textFaint,
      align: 'center',
    });
    return;
  }

  // Fit as many rows as the panel can hold without overlapping.
  const available = Math.max(24, rect.height - 30);
  const rowHeight = Math.max(24, Math.min(34, available / rows.length));
  const visible = rows.slice(0, Math.max(1, Math.floor(available / rowHeight)));
  const stride = available / visible.length;

  visible.forEach((row, index) => {
    const rowY = rect.y + 26 + stride * index;
    const budgetWidth = 58;
    drawText(ctx, `${row.name} ${row.uptimeLabel}`, rect.x + padding, rowY + 8, {
      size: 10,
      weight: 600,
      color: theme.text,
      maxWidth: rect.width - padding * 2 - budgetWidth - 8,
    });
    drawChip(ctx, rect.x + rect.width - padding, rowY, row.budgetLabel, row.color, theme, {
      align: 'right',
      height: 16,
      fontSize: 9,
    });

    // Availability bar with the SLO target marked on the track.
    const barY = rowY + 17;
    const barWidth = rect.width - padding * 2;
    drawProgressBar(ctx, {
      rect: { x: rect.x + padding, y: barY, width: barWidth, height: 5 },
      value: row.uptimePercent,
      color: row.color,
      track: theme.track,
      radius: 2.5,
    });
    const targetX = rect.x + padding + (barWidth * row.targetPercent) / 100;
    ctx.beginPath();
    ctx.moveTo(targetX, barY - 2);
    ctx.lineTo(targetX, barY + 7);
    ctx.strokeStyle = withAlpha(theme.text, 0.7);
    ctx.lineWidth = 1;
    ctx.stroke();

    add({
      id: `slo-${row.id}`,
      rect: { x: rect.x, y: rowY, width: rect.width, height: stride },
      tooltip: `${row.name} · ${row.uptimeLabel} (target ${row.targetLabel}) · ${row.budgetLabel}`,
      action: 'select-row',
      payload: { id: row.id },
    });
  });
}

export function drawIncidents(
  ctx: Ctx,
  rect: Rect,
  vm: UptimeViewModel,
  theme: ThemeTokens,
  add: HitCollector,
): void {
  drawPanel(ctx, rect, theme);
  const padding = 14;
  drawText(ctx, 'Incidents', rect.x + padding, rect.y + 17, { size: 12, weight: 700, color: theme.text });
  drawText(
    ctx,
    `${vm.incidents.openCount} open · ${vm.incidents.resolvedCount} resolved`,
    rect.x + rect.width - padding,
    rect.y + 17,
    { size: 9.5, weight: 600, color: theme.textFaint, align: 'right', maxWidth: rect.width * 0.6 },
  );

  const rows = vm.incidents.rows;
  if (rows.length === 0) {
    drawText(ctx, vm.incidents.emptyLabel, rect.x + rect.width / 2, rect.y + rect.height / 2, {
      size: 10.5,
      color: theme.textFaint,
      align: 'center',
    });
    return;
  }

  const rowHeight = Math.max(30, (rect.height - 32) / Math.min(rows.length, 5));
  rows.slice(0, 5).forEach((row, index) => {
    const rowY = rect.y + 28 + rowHeight * index;
    const selected = row.selected;
    if (selected) {
      ctx.beginPath();
      roundRectPath(ctx, rect.x + padding - 4, rowY, rect.width - padding * 2 + 8, rowHeight - 2, 7);
      ctx.fillStyle = withAlpha(theme.accents[0]!, 0.16);
      ctx.fill();
    }

    ctx.beginPath();
    roundRectPath(ctx, rect.x + padding - 1, rowY + 6, 3, rowHeight - 16, 1.5);
    ctx.fillStyle = row.color;
    ctx.fill();

    drawStatusDot(ctx, rect.x + padding + 10, rowY + 12, 2.6, row.open ? 'critical' : 'ok', theme);
    drawText(ctx, row.title, rect.x + padding + 20, rowY + 12, {
      size: 10.5,
      weight: 600,
      color: theme.text,
      maxWidth: rect.width - padding * 2 - 96,
    });
    drawChip(ctx, rect.x + rect.width - padding, rowY + 3, row.open ? row.stateLabel : row.severityLabel, row.color, theme, {
      align: 'right',
      height: 17,
      fontSize: 9.5,
    });
    drawText(ctx, `${row.servicesLabel} · ${row.durationLabel}`, rect.x + padding + 20, rowY + 26, {
      size: 9,
      weight: 500,
      color: theme.textMuted,
      maxWidth: rect.width - padding * 2 - 20,
    });

    add({
      id: `incident-${row.id}`,
      rect: { x: rect.x, y: rowY, width: rect.width, height: rowHeight },
      tooltip: `${row.severityLabel} · ${row.title} · ${row.durationLabel} ago ${row.ageLabel}`,
      action: 'select-incident',
      payload: { id: row.id },
    });
  });
}

/** Inspector: selected service heatmap strip or the selected incident timeline. */
export function drawDetail(
  ctx: Ctx,
  rect: Rect,
  vm: UptimeViewModel,
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
    maxWidth: rect.width - padding * 2 - 90,
  });

  if (detail.kind === 'none') {
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
    tooltip: 'Copy selection',
    action: 'copy',
    payload: { id: detail.title },
  });

  let cursor = rect.y + 36;
  drawText(ctx, detail.subtitle, rect.x + padding, cursor, {
    size: 10,
    weight: 600,
    color: theme.textMuted,
    maxWidth: rect.width - padding * 2,
  });
  cursor += 18;

  // Service selection: compact heatmap strip + sparkline of daily availability.
  if (detail.kind === 'service' && detail.cells.length > 1) {
    const step = Math.max(2, (rect.width - padding * 2) / detail.cells.length);
    const cellWidth = Math.max(1.5, step - 1);
    detail.cells.forEach((cell, index) => {
      ctx.beginPath();
      roundRectPath(
        ctx,
        rect.x + padding + index * step,
        cursor,
        cellWidth,
        Math.max(8, Math.min(18, rect.height * 0.08)),
        Math.min(2, cellWidth / 2),
      );
      ctx.fillStyle = withAlpha(cell.color, 0.9);
      ctx.fill();
    });
    cursor += Math.max(14, Math.min(24, rect.height * 0.1)) + 8;

    drawText(ctx, 'daily availability', rect.x + padding, cursor, {
      size: 9,
      weight: 700,
      color: theme.textFaint,
    });
    drawSparkline(
      ctx,
      { x: rect.x + padding + 96, y: cursor - 8, width: Math.max(20, rect.width - padding * 2 - 96), height: 22 },
      detail.cells.map((cell) => cell.uptime),
      detail.statusColor,
      theme,
    );
    cursor += 28;
  }

  // Incident updates as a vertical timeline.
  if (detail.updates.length > 0) {
    const lineX = rect.x + padding + 4;
    ctx.beginPath();
    ctx.moveTo(lineX, cursor + 2);
    ctx.lineTo(lineX, Math.min(rect.y + rect.height - 16, cursor + detail.updates.length * 20 - 8));
    ctx.strokeStyle = withAlpha(theme.text, 0.14);
    ctx.lineWidth = 1;
    ctx.stroke();

    for (const update of detail.updates) {
      if (cursor > rect.y + rect.height - 14) break;
      ctx.beginPath();
      ctx.arc(lineX, cursor + 4, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = detail.statusColor;
      ctx.fill();
      drawText(ctx, `${update.at} · ${update.state}`, rect.x + padding + 14, cursor + 4, {
        size: 9.5,
        weight: 700,
        color: theme.textMuted,
        maxWidth: rect.width - padding * 2 - 14,
      });
      const lines = wrapText(ctx, update.message, rect.width - padding * 2 - 14, { size: 10, maxLines: 2 });
      lines.forEach((line, index) => {
        drawText(ctx, line, rect.x + padding + 14, cursor + 16 + index * 12, {
          size: 10,
          weight: 500,
          color: theme.text,
          maxWidth: rect.width - padding * 2 - 14,
        });
      });
      cursor += 20 + Math.max(1, lines.length) * 12;
    }
    return;
  }

  // Key/value rows.
  for (const entry of detail.rows) {
    if (cursor > rect.y + rect.height - 12) break;
    drawText(ctx, entry.label.toUpperCase(), rect.x + padding, cursor, {
      size: 8.5,
      weight: 700,
      color: theme.textFaint,
      maxWidth: 62,
    });
    drawText(ctx, entry.value, rect.x + padding + 66, cursor, {
      size: 10.5,
      weight: 600,
      color: theme.text,
      maxWidth: rect.width - padding * 2 - 66,
    });
    cursor += 16;
  }
}

