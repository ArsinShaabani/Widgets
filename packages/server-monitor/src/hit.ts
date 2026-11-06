import type { Rect } from './geometry';

/** Interactive region produced by the renderer and consumed by the element. */
export interface HitRegion {
  /** Stable id, e.g. `cpu-core-3`, `donut-memory`, `action-logs`. */
  id: string;
  rect: Rect;
  /** Text shown in the hover tooltip. */
  tooltip?: string;
  /** Action id forwarded to `config.onAction` when the region is clicked. */
  action?: string;
  /** Optional payload forwarded alongside the action. */
  payload?: unknown;
  /** Regions with `shape: 'circle'` are hit-tested by radius. */
  shape?: 'rect' | 'circle';
  /** Circle radius (circle regions only). */
  radius?: number;
}

export type HitCollector = (region: HitRegion) => void;

/** Creates a collector that de-duplicates regions by id (last one wins). */
export function createHitCollector(): { add: HitCollector; regions: HitRegion[] } {
  const index = new Map<string, HitRegion>();
  return {
    add: (region) => index.set(region.id, region),
    get regions() {
      return [...index.values()];
    },
  };
}

/** True when a point is inside a hit region (rect or circle). */
export function hitTest(region: HitRegion, x: number, y: number): boolean {
  if (region.shape === 'circle') {
    const cx = region.rect.x + region.rect.width / 2;
    const cy = region.rect.y + region.rect.height / 2;
    const radius = region.radius ?? Math.min(region.rect.width, region.rect.height) / 2;
    return Math.hypot(x - cx, y - cy) <= radius;
  }
  return (
    x >= region.rect.x &&
    x <= region.rect.x + region.rect.width &&
    y >= region.rect.y &&
    y <= region.rect.y + region.rect.height
  );
}

/** Finds the top-most region containing the point (regions are checked in reverse). */
export function findRegion(regions: readonly HitRegion[], x: number, y: number): HitRegion | undefined {
  for (let i = regions.length - 1; i >= 0; i -= 1) {
    const region = regions[i]!;
    if (hitTest(region, x, y)) return region;
  }
  return undefined;
}
