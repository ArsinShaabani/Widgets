import { resolveTheme, type ThemeName, type ThemeTokens } from '@widgets/core';
import {
  createHitCollector,
  drawStatusDot,
  drawText,
  roundRectPath,
  type Ctx,
  type HitRegion,
} from '@widgets/render';
import { drawDetail, drawHistogram, drawServices } from './draw/analytics';
import { drawFilters, drawSeverityMix, drawToolbar } from './draw/chrome';
import { drawStream } from './draw/stream';
import type { LogLayout, LogSectionId } from './layout';
import type { LogViewModel } from './view-model';

/** Renderer: paints a whole log-stream frame and reports its interactive regions. */

export interface LogRenderOptions {
  theme: ThemeName | ThemeTokens;
  layout: LogLayout;
  vm: LogViewModel;
  /** Region id under the pointer (highlighted + hover tint in the list). */
  hoverId?: string;
  /** Optional tooltip anchored at the pointer. */
  tooltip?: { text: string; x: number; y: number } | null;
}

export interface LogRenderResult {
  regions: HitRegion[];
  theme: ThemeTokens;
}

type SectionPainter = (
  ctx: Ctx,
  rect: NonNullable<LogLayout['sections'][LogSectionId]>,
  vm: LogViewModel,
  theme: ThemeTokens,
  add: (region: HitRegion) => void,
) => void;

const SECTION_PAINTERS: Record<LogSectionId, SectionPainter> = {
  toolbar: drawToolbar,
  filters: drawFilters,
  stream: (ctx, rect, vm, theme, add) => drawStream(ctx, rect, vm, theme, add),
  severityMix: drawSeverityMix,
  histogram: drawHistogram,
  detail: drawDetail,
  services: drawServices,
};

/** Paints one frame. Expects a context already scaled for the device pixel ratio. */
export function renderLogWidget(ctx: Ctx, options: LogRenderOptions): LogRenderResult {
  const theme = typeof options.theme === 'string' ? resolveTheme(options.theme) : options.theme;
  const { layout, vm } = options;
  const collector = createHitCollector();

  ctx.save();
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, layout.width, layout.height);

  for (const id of layout.order) {
    if (vm.hidden.has(id)) continue;
    const rect = layout.sections[id];
    if (!rect || rect.height <= 8 || rect.width <= 24) continue;
    if (id === 'stream') {
      drawStream(ctx, rect, vm, theme, collector.add, {
        ...(options.hoverId ? { hoverId: options.hoverId } : {}),
      });
      continue;
    }
    SECTION_PAINTERS[id](ctx, rect, vm, theme, collector.add);
  }

  if (vm.stream.pending && vm.stream.filteredTotal === 0) drawPendingOverlay(ctx, layout, vm, theme);
  if (options.hoverId) highlightRegion(ctx, collector.regions, options.hoverId, theme);
  if (options.tooltip) drawTooltip(ctx, layout, options.tooltip, theme);
  ctx.restore();

  return { regions: collector.regions, theme };
}

/** Skeleton banner shown until the first batch arrives. */
function drawPendingOverlay(ctx: Ctx, layout: LogLayout, vm: LogViewModel, theme: ThemeTokens): void {
  const stream = layout.sections.stream;
  if (!stream) return;
  const width = Math.min(260, stream.width - 24);
  const height = 40;
  const x = stream.x + (stream.width - width) / 2;
  const y = stream.y + (stream.height - height) / 2;
  ctx.beginPath();
  roundRectPath(ctx, x, y, width, height, 10);
  ctx.fillStyle = theme.surfaceRaised;
  ctx.fill();
  drawStatusDot(ctx, x + 20, y + height / 2, 4, 'unknown', theme);
  drawText(ctx, `${vm.toolbar.connection.label} · ${vm.stream.emptyMessage}`, x + 34, y + height / 2, {
    size: 11.5,
    weight: 600,
    color: theme.text,
    maxWidth: width - 46,
  });
}

function highlightRegion(ctx: Ctx, regions: readonly HitRegion[], hoverId: string, theme: ThemeTokens): void {
  const region = regions.find((item) => item.id === hoverId);
  if (!region || region.id.startsWith('row-')) return;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = theme.textFaint;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  if (region.shape === 'circle') {
    const cx = region.rect.x + region.rect.width / 2;
    const cy = region.rect.y + region.rect.height / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, (region.radius ?? region.rect.width / 2) + 3, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.strokeRect(region.rect.x + 1, region.rect.y + 1, region.rect.width - 2, region.rect.height - 2);
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawTooltip(
  ctx: Ctx,
  layout: LogLayout,
  tooltip: { text: string; x: number; y: number },
  theme: ThemeTokens,
): void {
  ctx.save();
  drawText(ctx, tooltip.text, 0, 0, { size: 11, weight: 600 });
  const textWidth = ctx.measureText(tooltip.text).width;
  const width = Math.min(layout.width - 16, textWidth + 20);
  const height = 26;
  const x = Math.min(Math.max(8, tooltip.x + 12), layout.width - width - 8);
  const y = Math.min(Math.max(8, tooltip.y - height - 10), layout.height - height - 8);

  ctx.globalAlpha = 0.96;
  ctx.fillStyle = theme.name === 'dark' ? '#0d1420' : '#ffffff';
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, width, height, 6);
  else ctx.rect(x, y, width, height);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;
  drawText(ctx, tooltip.text, x + 10, y + height / 2 + 0.5, {
    size: 11,
    weight: 600,
    color: theme.text,
    maxWidth: width - 20,
  });
  ctx.restore();
}
