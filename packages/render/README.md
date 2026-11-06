# @widgets/render

The canvas rendering kit shared by every widget in the collection. Pure, DOM-free and fully
unit-testable — a recording canvas double ships with it, so widget authors can assert draw calls
without installing a native canvas.

```bash
npm install @widgets/render
```

## What is inside

| Export | Purpose |
| --- | --- |
| `linearScale`, `niceTicks`, `ceilToStep`, `clamp`, `lerp` | axis and value maths |
| `monotoneCubicSegments`, `seriesToPoints` | PCHIP chart curves that cannot invent peaks |
| `roundRectPath`, `capsulePath`, `ringSegmentPath`, `polar`, `TAU` | path builders (bars, donuts, gauges) |
| `createHitCollector`, `findRegion`, `hitTest` | the hit-region model that keeps drawing and interaction in sync |
| `drawPanel`, `drawText`, `setFont`, `drawChip`, `drawProgressBar`, `drawRings`, `drawStatusDot`, `drawIconButton`, `barGradient`, `traceSmoothPath` | drawing primitives |
| `ICON_PATHS`, `IconName` | stroke glyphs (settings, logs, share, network, location, link, server, alert) |
| `@widgets/render/testing` | `createFakeContext()` — a recording `CanvasRenderingContext2D` double |

## Usage

```ts
import { drawPanel, drawText, drawProgressBar, createHitCollector, type Ctx, type Rect } from '@widgets/render';
import { resolveTheme } from '@widgets/core';

export function drawThroughput(ctx: Ctx, rect: Rect, value: number, theme = resolveTheme('dark')) {
  drawPanel(ctx, rect, theme);
  drawText(ctx, `${value.toFixed(1)} MB/s`, rect.x + 16, rect.y + 20, {
    size: 12.5,
    weight: 700,
    color: theme.text,
  });
  drawProgressBar(ctx, {
    rect: { x: rect.x + 16, y: rect.y + 40, width: rect.width - 32, height: 8 },
    value,
    color: theme.accents[0],
    track: theme.track,
  });
  return createHitCollector();
}
```

## Testing a painter

```ts
import { createFakeContext } from '@widgets/render/testing';

const ctx = createFakeContext();
drawThroughput(ctx, { x: 0, y: 0, width: 200, height: 80 }, 42);
expect(ctx.calls.fill).toBeGreaterThan(0);
expect(ctx.texts).toContain('42.0 MB/s');
```

## Conventions

- Every painter takes explicit coordinates; the caller applies the device-pixel-ratio transform once.
- Anything interactive must also register a hit region with a tooltip/action.
- Colours always come from `ThemeTokens` (`theme.accents`, `theme.status`, `theme.levels`, …) so dark
  and light themes and per-instance overrides keep working.
