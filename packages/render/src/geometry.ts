/**
 * Pure geometry helpers for the canvas renderers.
 *
 * Everything here is side-effect free and DOM free, which keeps the maths unit
 * testable and reusable by native renderers (Compose/SwiftUI) later on.
 */

import type { TimeSeriesPoint } from '@widgets/core';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PolarPoint {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/** Maps values from one range onto another, clamped to the output range. */
export function linearScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): (value: number) => number {
  const span = domainMax - domainMin;
  return (value: number) => {
    if (span === 0) return rangeMin;
    const t = clamp((value - domainMin) / span, 0, 1);
    return rangeMin + t * (rangeMax - rangeMin);
  };
}

/** Rounds a value up to the next multiple of `step`. */
export function ceilToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.ceil(value / step) * step;
}

/**
 * Produces evenly spaced, human friendly tick values for an axis.
 * `niceTicks(0, 87, 3)` → `[0, 50, 100]`.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  if (safeMax === safeMin) return [safeMin];
  const rawStep = (safeMax - safeMin) / Math.max(1, count);
  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = 10 ** exponent;
  const normalized = rawStep / magnitude;
  // 1 / 2 / 2.5 / 5 / 10 keeps axis labels readable (0, 25, 50, 75, 100 …).
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  const start = Math.floor(safeMin / step) * step;
  const end = Math.ceil(safeMax / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

/** Point on a circle; `angle` in radians, 0 = 3 o'clock, growing clockwise. */
export function polar(cx: number, cy: number, radius: number, angle: number): PolarPoint {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

/** Sets a round-rect path on the context. */
export function roundRectPath(
  ctx: CanvasPath,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Vertical capsule with rounded caps — the mock-up's bar shape. */
export function capsulePath(ctx: CanvasPath, x: number, y: number, width: number, height: number): void {
  roundRectPath(ctx, x, y, width, height, Math.min(width / 2, height / 2));
}

/**
 * Ring / pie segment path between `start` and `end` radians.
 * An inner radius of 0 produces a pie slice instead of an annulus.
 */
export function ringSegmentPath(
  ctx: CanvasPath,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  start: number,
  end: number,
): void {
  const clockwise = end > start;
  const sweep = Math.abs(end - start);
  const fullCircle = sweep >= TAU - 1e-6;
  const outerRadius = Math.max(0, outer);
  const innerRadius = Math.max(0, inner);

  const startOuter = polar(cx, cy, outerRadius, start);
  ctx.moveTo(startOuter.x, startOuter.y);
  if (fullCircle) {
    ctx.arc(cx, cy, outerRadius, 0, TAU);
  } else {
    ctx.arc(cx, cy, outerRadius, start, end, !clockwise);
  }
  if (innerRadius > 0) {
    const endInner = polar(cx, cy, innerRadius, end);
    ctx.lineTo(endInner.x, endInner.y);
    ctx.arc(cx, cy, innerRadius, end, start, clockwise);
  } else {
    ctx.lineTo(cx, cy);
  }
  ctx.closePath();
}

export interface CubicSegment {
  x: number;
  y: number;
  cx1: number;
  cy1: number;
  cx2: number;
  cy2: number;
}

/**
 * Monotone cubic interpolation (PCHIP) for the area chart.
 *
 * Monotone curves never overshoot the data, so a throughput chart stays honest
 * instead of inventing peaks between samples.
 */
export function monotoneCubicSegments(
  points: ReadonlyArray<{ x: number; y: number }>,
): CubicSegment[] {
  const n = points.length;
  if (n < 2) return [];

  const widths: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const h = points[i + 1]!.x - points[i]!.x || 1e-6;
    widths.push(h);
    slopes.push((points[i + 1]!.y - points[i]!.y) / h);
  }

  const tangents: number[] = new Array<number>(n);
  tangents[0] = slopes[0]!;
  tangents[n - 1] = slopes[n - 2]!;
  for (let i = 1; i < n - 1; i += 1) {
    const s0 = slopes[i - 1]!;
    const s1 = slopes[i]!;
    if (s0 * s1 <= 0) {
      tangents[i] = 0;
      continue;
    }
    const h0 = widths[i - 1]!;
    const h1 = widths[i]!;
    const w1 = 2 * h1 + h0;
    const w2 = h1 + 2 * h0;
    tangents[i] = (w1 + w2) / (w1 / s0 + w2 / s1);
  }

  const segments: CubicSegment[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    const h = widths[i]!;
    segments.push({
      x: p0.x,
      y: p0.y,
      cx1: p0.x + h / 3,
      cy1: p0.y + (tangents[i]! * h) / 3,
      cx2: p1.x - h / 3,
      cy2: p1.y - (tangents[i + 1]! * h) / 3,
    });
  }
  const last = points[n - 1]!;
  segments.push({
    x: last.x,
    y: last.y,
    cx1: last.x,
    cy1: last.y,
    cx2: last.x,
    cy2: last.y,
  });
  return segments;
}

/** Converts a time series into pixel coordinates inside `rect`. */
export function seriesToPoints(
  series: ReadonlyArray<TimeSeriesPoint>,
  rect: Rect,
  min: number,
  max: number,
): Array<{ x: number; y: number }> {
  if (series.length === 0) return [];
  const scaleY = linearScale(min, max, rect.y + rect.height, rect.y);
  const scaleX = linearScale(0, Math.max(1, series.length - 1), rect.x, rect.x + rect.width);
  return series.map((point, index) => ({ x: scaleX(index), y: scaleY(point.v) }));
}

/** Truncates text with an ellipsis so labels never overflow their box. */
export function ellipsize(text: string, maxWidth: number, measure: (value: string) => number): string {
  if (maxWidth <= 0) return '';
  if (measure(text) <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(`${text.slice(0, mid)}…`) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low <= 0 ? '' : `${text.slice(0, low)}…`;
}

