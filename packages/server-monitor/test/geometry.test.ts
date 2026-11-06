import { describe, expect, it } from 'vitest';
import {
  capsulePath,
  clamp,
  ellipsize,
  linearScale,
  monotoneCubicSegments,
  niceTicks,
  polar,
  ringSegmentPath,
  seriesToPoints,
} from '../src/index';
import { createFakeContext } from '@widgets/render/testing';

describe('geometry', () => {
  it('maps domains onto ranges and clamps at the edges', () => {
    const scale = linearScale(0, 100, 0, 200);
    expect(scale(0)).toBe(0);
    expect(scale(50)).toBe(100);
    expect(scale(150)).toBe(200);
    expect(scale(-20)).toBe(0);
  });

  it('handles degenerate domains', () => {
    expect(linearScale(5, 5, 10, 20)(5)).toBe(10);
  });

  it('produces human friendly ticks', () => {
    expect(niceTicks(0, 87, 3)).toEqual([0, 50, 100]);
    expect(niceTicks(0, 100, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(3, 3)).toEqual([3]);
  });

  it('clamps helper', () => {
    expect(clamp(12, 0, 10)).toBe(10);
    expect(clamp(-2, 0, 10)).toBe(0);
  });

  it('places polar points clockwise from 3 o’clock', () => {
    const right = polar(0, 0, 10, 0);
    expect(right.x).toBeCloseTo(10, 6);
    expect(right.y).toBeCloseTo(0, 6);
    const bottom = polar(0, 0, 10, Math.PI / 2);
    expect(bottom.y).toBeCloseTo(10, 6);
  });

  it('builds a closed ring segment path', () => {
    const ctx = createFakeContext();
    ctx.beginPath();
    ringSegmentPath(ctx, 50, 50, 40, 22, -Math.PI / 2, Math.PI / 2);
    expect(ctx.calls.moveTo).toBe(1);
    expect(ctx.calls.arc).toBe(2);
    expect(ctx.calls.lineTo).toBe(1);
    expect(ctx.calls.closePath).toBe(1);
  });

  it('builds a pie slice when the inner radius is zero', () => {
    const ctx = createFakeContext();
    ringSegmentPath(ctx, 50, 50, 40, 0, 0, Math.PI / 2);
    expect(ctx.calls.arc).toBe(1);
    expect(ctx.calls.lineTo).toBe(1);
  });

  it('builds capsule paths for bars', () => {
    const ctx = createFakeContext();
    capsulePath(ctx, 10, 10, 8, 100);
    expect(ctx.calls.moveTo).toBe(1);
    expect(ctx.calls.closePath).toBe(1);
  });

  it('interpolates monotonically without overshooting the data', () => {
    const points = [
      { x: 0, y: 100 },
      { x: 50, y: 10 },
      { x: 100, y: 90 },
      { x: 150, y: 20 },
    ];
    const segments = monotoneCubicSegments(points);
    expect(segments).toHaveLength(points.length);
    for (const segment of segments) {
      expect(Number.isFinite(segment.cx1)).toBe(true);
      expect(Number.isFinite(segment.cy2)).toBe(true);
      expect(segment.cy1).toBeGreaterThanOrEqual(Math.min(segment.y, segment.cy2) - 60);
      expect(segment.cy1).toBeLessThanOrEqual(Math.max(segment.y, segment.cy2) + 60);
    }
  });

  it('returns no segments for a single point', () => {
    expect(monotoneCubicSegments([{ x: 1, y: 1 }])).toEqual([]);
  });

  it('projects series points inside the plot rect', () => {
    const rect = { x: 10, y: 20, width: 100, height: 50 };
    const points = seriesToPoints(
      [
        { t: 0, v: 0 },
        { t: 1, v: 50 },
        { t: 2, v: 100 },
      ],
      rect,
      0,
      100,
    );
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ x: 10, y: 70 });
    expect(points[1]).toEqual({ x: 60, y: 45 });
    expect(points[2]).toEqual({ x: 110, y: 20 });
  });

  it('ellipsizes long labels to fit a width budget', () => {
    const measure = (value: string) => value.length * 10;
    expect(ellipsize('short', 100, measure)).toBe('short');
    expect(ellipsize('a very long label', 60, measure)).toBe('a ver…');
    expect(ellipsize('abc', 0, measure)).toBe('');
  });
});
