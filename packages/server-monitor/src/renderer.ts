import { resolveTheme, type ThemeName, type ThemeTokens } from '@widgets/core';
import { drawCpuBars, drawDonuts, drawGauges, drawNetwork } from './draw/charts';
import { drawActions, drawBadges, drawDualBars, drawHost, drawResourceBars } from './draw/host';
import { drawStatusDot, drawText, type Ctx } from '@widgets/render';
import type { SectionId } from './layout';
import type { LayoutResult } from './layout';
import { createHitCollector, type HitRegion } from '@widgets/render';
import type { ViewModel } from './view-model';

/** Renderer: paints a whole frame and reports the interactive regions it drew. */

export interface RenderOptions {
  theme: ThemeName | ThemeTokens | ThemeTokens;
  layout: LayoutResult;
  vm: ViewModel;
  /** Region id under the pointer, highlighted on hover. */
  hoverId?: string;
  /** Optional tooltip anchored at the pointer. */
  tooltip?: { text: string; x: number; y: number } | null;
}

export interface RenderResult {
  regions: HitRegion[];
  /** Resolved theme used for this frame (useful for hosts/tests). */
  theme: ThemeTokens;
}

type SectionRenderer = (ctx: Ctx, rect: LayoutResult['sections'][SectionId], vm: ViewModel, theme: ThemeTokens, add: ReturnType<typeof createHitCollector>['add']) => void;

const SECTION_RENDERERS: Record<SectionId, (ctx: Ctx, rect: NonNullable<LayoutResult['sections'][SectionId]>, vm: ViewModel, theme: ThemeTokens, add: (region: HitRegion) => void) => void> = {
  host: drawHost,
  badges: drawBadges,
  gauges: drawGauges,
  cpuBars: drawCpuBars,
  donuts: drawDonuts,
  network: drawNetwork,
  resourceBars: drawResourceBars,
  dualBars: drawDualBars,
  actions: drawActions,
};

/** Paints one frame. Expects a context already scaled for the device pixel ratio. */
export function renderDashboard(ctx: Ctx, options: RenderOptions): RenderResult {
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
    if (!rect || rect.height <= 6 || rect.width <= 20) continue;
    const renderer = SECTION_RENDERERS[id];
    renderer(ctx, rect, vm, theme, collector.add);
  }

  if (vm.pending) drawPendingOverlay(ctx, layout, vm, theme);
  if (options.hoverId) highlightRegion(ctx, collector.regions, options.hoverId, theme);
  if (options.tooltip) drawTooltip(ctx, layout, options.tooltip, theme);
  ctx.restore();

  return { regions: collector.regions, theme };
}

/** Skeleton banner shown until the first snapshot arrives. */
function drawPendingOverlay(ctx: Ctx, layout: LayoutResult, vm: ViewModel, theme: ThemeTokens): void {
  const width = Math.min(280, layout.width - 40);
  const height = 44;
  const x = (layout.width - width) / 2;
  const y = (layout.height - height) / 2;
  ctx.beginPath();
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = theme.surfaceRaised;
  ctx.fillRect(x, y, width, height);
  ctx.globalAlpha = 1;
  drawStatusDot(ctx, x + 22, y + height / 2, 4, 'unknown', theme);
  drawText(ctx, `${vm.connection.label} · ${vm.connection.description}`, x + 36, y + height / 2, {
    size: 12,
    weight: 600,
    color: theme.text,
    maxWidth: width - 48,
  });
}

/** Traces a soft outline around the hovered region. */
function highlightRegion(ctx: Ctx, regions: readonly HitRegion[], hoverId: string, theme: ThemeTokens): void {
  const region = regions.find((item) => item.id === hoverId);
  if (!region) return;
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

/** Rounded tooltip clamp inside the widget bounds. */
function drawTooltip(
  ctx: Ctx,
  layout: LayoutResult,
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
  ctx.roundRect?.(x, y, width, height, 6);
  if (!ctx.roundRect) ctx.rect(x, y, width, height);
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
