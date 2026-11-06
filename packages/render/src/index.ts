/**
 * @widgets/render — the canvas rendering kit shared by every widget.
 *
 * Contains only pure, DOM-free drawing helpers plus the hit-region model, so a
 * widget package is left with three responsibilities: define data (`core`),
 * layout it, and paint it with these primitives.
 *
 * ```ts
 * import { drawPanel, drawText, roundRectPath, createHitCollector } from '@widgets/render';
 *
 * export function draw(section, ctx, rect, vm, theme, add) {
 *   drawPanel(ctx, rect, theme);
 *   drawText(ctx, vm.title, rect.x + 16, rect.y + 20, { size: 12.5, weight: 700, color: theme.text });
 *   add({ id: 'section', rect, tooltip: vm.title });
 * }
 * ```
 */

export {
  TAU,
  capsulePath,
  ceilToStep,
  clamp,
  ellipsize,
  lerp,
  linearScale,
  monotoneCubicSegments,
  niceTicks,
  polar,
  ringSegmentPath,
  roundRectPath,
  seriesToPoints,
  type CubicSegment,
  type PolarPoint,
  type Rect,
} from './geometry';

export {
  createHitCollector,
  findRegion,
  hitTest,
  type HitCollector,
  type HitRegion,
} from './hit';

export { ICON_PATHS, type IconName } from './icons';

export {
  barGradient,
  drawChip,
  drawIconButton,
  drawPanel,
  drawProgressBar,
  drawRings,
  drawSparkline,
  drawStatusDot,
  drawText,
  fontStack,
  setFont,
  traceSmoothPath,
  wrapText,
  type Ctx,
  type IconButtonOptions,
  type IconPainter,
  type ProgressBarOptions,
  type TextOptions,
} from './primitives';
