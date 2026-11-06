import { withAlpha, type StatusLevel, type ThemeTokens } from '@widgets/core';
import { clamp, roundRectPath, ellipsize, type Rect } from './geometry';
import { ICON_PATHS, type IconName } from './icons';

/**
 * Low level canvas primitives.
 *
 * Every helper takes explicit coordinates so the same routines work at any
 * device pixel ratio; the caller applies a single transform per frame.
 */

export type Ctx = CanvasRenderingContext2D;

export interface TextOptions {
  size?: number;
  weight?: number | string;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** Truncate with an ellipsis when the text exceeds this width. */
  maxWidth?: number;
}

export const fontStack =
  'Inter, "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

export function setFont(ctx: Ctx, options: TextOptions = {}): void {
  const size = options.size ?? 12;
  const weight = options.weight ?? 500;
  ctx.font = `${weight} ${size}px ${fontStack}`;
}

/** Draws text and returns the width actually used (after truncation). */
export function drawText(ctx: Ctx, text: string, x: number, y: number, options: TextOptions = {}): number {
  setFont(ctx, options);
  const measured = ctx.measureText(text).width;
  const finalText =
    options.maxWidth && measured > options.maxWidth
      ? ellipsize(text, options.maxWidth, (value) => ctx.measureText(value).width)
      : text;
  ctx.fillStyle = options.color ?? '#ffffff';
  ctx.textAlign = options.align ?? 'left';
  ctx.textBaseline = options.baseline ?? 'middle';
  ctx.fillText(finalText, x, y);
  return ctx.measureText(finalText).width;
}

/** Panel surface: subtle vertical sheen + hairline border, like the design. */
export function drawPanel(ctx: Ctx, rect: Rect, theme: ThemeTokens, radius = 14): void {
  const gradient = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height);
  gradient.addColorStop(0, withAlpha('#ffffff', 0.045));
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.beginPath();
  roundRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius);
  ctx.fillStyle = theme.surface;
  ctx.fill();
  ctx.fillStyle = gradient;
  ctx.fill();
  if (theme.name === 'dark') {
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** Gradient helper that follows the design's magenta → indigo → blue ascent. */
export function barGradient(
  ctx: Ctx,
  x: number,
  top: number,
  bottom: number,
  theme: ThemeTokens,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(x, top, x, bottom);
  gradient.addColorStop(0, theme.gradient[0]);
  gradient.addColorStop(0.55, theme.gradient[1]);
  gradient.addColorStop(1, theme.gradient[2]);
  return gradient;
}

export interface ProgressBarOptions {
  rect: Rect;
  value: number;
  color: string;
  track: string;
  /** Rounded capsule ends (design style) or squared ends. */
  radius?: number;
  /** Optional secondary segment drawn after the primary one. */
  secondaryValue?: number;
  secondaryColor?: string;
}

/** Horizontal capsule progress bar used by the host card and resource lists. */
export function drawProgressBar(ctx: Ctx, options: ProgressBarOptions): void {
  const { rect, value, color, track } = options;
  const radius = options.radius ?? rect.height / 2;
  const primary = clamp(value, 0, 100);
  const secondary = clamp(options.secondaryValue ?? 0, 0, Math.max(0, 100 - primary));

  ctx.beginPath();
  roundRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius);
  ctx.fillStyle = track;
  ctx.fill();

  const primaryWidth = (rect.width * primary) / 100;
  if (primaryWidth > 0.5) {
    ctx.beginPath();
    roundRectPath(ctx, rect.x, rect.y, primaryWidth, rect.height, radius);
    ctx.fillStyle = color;
    ctx.fill();
  }

  const secondaryWidth = (rect.width * secondary) / 100;
  if (secondaryWidth > 0.5) {
    ctx.beginPath();
    roundRectPath(ctx, rect.x + primaryWidth, rect.y, secondaryWidth, rect.height, radius);
    ctx.fillStyle = options.secondaryColor ?? withAlpha(color, 0.55);
    ctx.fill();
  }
}

/** Small rounded value chip (the design's "88%" / "47%" pills). */
export function drawChip(
  ctx: Ctx,
  x: number,
  y: number,
  text: string,
  color: string,
  theme: ThemeTokens,
  options: { height?: number; align?: 'left' | 'right'; fontSize?: number } = {},
): Rect {
  const height = options.height ?? 20;
  const fontSize = options.fontSize ?? 11;
  setFont(ctx, { size: fontSize, weight: 700 });
  const width = Math.max(height + 4, ctx.measureText(text).width + 16);
  const left = options.align === 'right' ? x - width : x;

  ctx.beginPath();
  roundRectPath(ctx, left, y, width, height, 4);
  ctx.fillStyle = color;
  ctx.fill();
  drawText(ctx, text, left + width / 2, y + height / 2 + 0.5, {
    size: fontSize,
    weight: 700,
    color: theme.name === 'dark' ? '#ffffff' : '#0b1220',
    align: 'center',
  });
  return { x: left, y, width, height };
}

/** Status dot with a soft halo. */
export function drawStatusDot(
  ctx: Ctx,
  cx: number,
  cy: number,
  radius: number,
  status: StatusLevel,
  theme: ThemeTokens,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 2.1, 0, Math.PI * 2);
  ctx.fillStyle = theme.statusSoft[status] ?? theme.statusSoft.unknown;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = theme.status[status] ?? theme.status.unknown;
  ctx.fill();
}

export interface IconButtonOptions {
  cx: number;
  cy: number;
  radius: number;
  /** Shared glyph name, or a custom painter `(ctx, cx, cy) => void` in a 24×24 box. */
  icon: IconName | IconPainter;
  theme: ThemeTokens;
  /** Emphasised button (host avatar ring, active state). */
  accent?: string;
  /** Fill override; defaults to the raised surface colour. */
  fill?: string;
  /** Glyph colour override. */
  iconColor?: string;
}

/** Custom glyph painter, drawn inside a 24×24 box centred on (0, 0). */
export type IconPainter = (ctx: CanvasPath, cx: number, cy: number) => void;

/** Circular icon button: ring + glyph, identical in both themes. */
export function drawIconButton(ctx: Ctx, options: IconButtonOptions): void {
  const { cx, cy, radius, icon, theme, accent } = options;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = options.fill ?? (accent ? withAlpha(accent, 0.16) : theme.surfaceRaised);
  ctx.fill();
  ctx.strokeStyle = accent ?? theme.border;
  ctx.lineWidth = accent ? 1.6 : 1;
  ctx.stroke();

  const painter: IconPainter = typeof icon === 'function' ? icon : ICON_PATHS[icon];
  const scale = (radius * 1.05) / 24;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.strokeStyle = options.iconColor ?? theme.text;
  ctx.lineWidth = 1.9 / scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  painter(ctx, 0, 0);
  ctx.stroke();
  ctx.restore();
}

/** Concentric ring used by the design's 01/02/03 status buttons. */
export function drawRings(
  ctx: Ctx,
  cx: number,
  cy: number,
  radius: number,
  theme: ThemeTokens,
  accent: string,
  progress = 1,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(3, radius * 0.11);
  ctx.strokeStyle = withAlpha(accent, 0.35);
  ctx.stroke();

  if (progress > 0.001) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(progress, 0, 1), false);
    ctx.strokeStyle = accent;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.78, 0, Math.PI * 2);
  ctx.strokeStyle = theme.name === 'dark' ? withAlpha('#ffffff', 0.85) : theme.border;
  ctx.lineWidth = Math.max(2, radius * 0.09);
  ctx.stroke();
}

/** Traces a monotone cubic path from chart points. */
export function traceSmoothPath(
  ctx: Ctx,
  segments: ReadonlyArray<{ x: number; y: number; cx1: number; cy1: number; cx2: number; cy2: number }>,
): void {
  if (segments.length === 0) return;
  ctx.moveTo(segments[0]!.x, segments[0]!.y);
  for (const segment of segments) {
    ctx.bezierCurveTo(segment.cx1, segment.cy1, segment.cx2, segment.cy2, segment.x, segment.y);
  }
}

/**
 * Greedy word wrap for multi-line text blocks (log messages, descriptions).
 * Words longer than the line box are hard-split so nothing overflows.
 */
export function wrapText(
  ctx: Ctx,
  text: string,
  maxWidth: number,
  options: { maxLines?: number; size?: number; weight?: number | string } = {},
): string[] {
  if (!text) return [];
  const maxLines = options.maxLines ?? Number.POSITIVE_INFINITY;
  setFont(ctx, { size: options.size ?? 12, weight: options.weight ?? 500 });
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (lines.length >= maxLines) break;
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current.length > 0) lines.push(current);
      if (lines.length >= maxLines) break;
      // Hard-split a single word that cannot fit on its own line.
      let piece = word;
      while (ctx.measureText(piece).width > maxWidth && piece.length > 1) {
        let cut = piece.length - 1;
        while (cut > 1 && ctx.measureText(`${piece.slice(0, cut)}…`).width > maxWidth) cut -= 1;
        lines.push(`${piece.slice(0, cut)}…`);
        piece = piece.slice(cut);
        if (lines.length >= maxLines) break;
      }
      current = piece;
    }
    if (current.length > 0 && lines.length < maxLines) lines.push(current);
  }

  return lines;
}

