# Authoring a new widget

Widget #1 (`server-monitor`) established the pattern; adding widget #2 should mean writing a data
mapper, a layout, painters and one element — **no plumbing**.

## 1. Data first (`@widgets/core`)

Add the contract to `packages/core/src/types.ts`:

```ts
export interface LogEntry {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  message: string;
  timestamp: number;
}

export interface LogSnapshot {
  timestamp: number;
  entries: LogEntry[];
}
```

Then extend `normalizeSnapshot` (or add a `normalizeLogSnapshot`) so backends with their own shape
map into it, and reuse `Emitter`, `WidgetStore`-style buffering, `createTranslator` and `formatBytes`
rather than re-implementing them.

**Rule:** core has no DOM access. If you need `document`, `window` or `HTMLElement`, that code
belongs in the widget package.

## 2. Package skeleton

```
packages/log-stream/
  package.json        # name @widgets/log-stream, dependency @widgets/core
  tsconfig.json       # extends ../../tsconfig.base.json
  tsconfig.build.json # maps @widgets/core → ../core/dist/index.d.ts
  tsup.config.ts      # ESM + dts, and an IIFE bundle for WebView hosts
  src/
    config.ts         # WidgetSource + config defaults/validation (copy the server-monitor shape)
    layout.ts         # PURE section layout (rects only, no drawing)
    view-model.ts     # PURE snapshot → labels/values/colours/statuses
    geometry.ts       # reuse @widgets/server-monitor's helpers or add yours
    renderer.ts       # frame orchestration + hit regions
    draw/*.ts         # painters
    element.ts        # custom element: lifecycle, resize, pointer/keyboard, a11y, events
    define.ts, index.ts, auto.ts
  test/*.test.ts
```

Register it in the root `package.json` scripts (`build`) and in `vitest.config.ts` aliases.

## 3. Follow the invariants

1. **Pure layout & view model.** `computeLayout(width, height, options)` and
   `buildViewModel(input)` must be deterministic, DOM-free functions. That is what makes widgets
   testable and portable to native renderers later.
2. **One painter per section**, signature `(ctx, rect, viewModel, theme, addHitRegion)`.
3. **Register a hit region for anything interactive** — the element resolves pointer and keyboard
   input against the regions you drew, so drawing and interaction can never drift apart.
4. **Respect the theme tokens** (`resolveTheme` + `themeOverride`) instead of hard-coded colours.
5. **Localise every string** through `createTranslator(locale, messages)` and add keys to
   `packages/core/src/i18n.ts`.
6. **Degrade gracefully:** no snapshot → `pending` view model; no 2D context → still publish
   `layout`/`viewModel` for headless hosts; unknown sections → drop by priority instead of clipping.
7. **Dispose everything** in `disconnectedCallback` (transports, observers, timers, listeners).

## 4. Tests to write

| File | What to assert |
| --- | --- |
| `test/geometry.test.ts` | scale/tick/interpolation maths, using `test/helpers/fake-ctx.ts` for path calls |
| `test/layout.test.ts` | no overlap, inside bounds, priority dropping, column switching |
| `test/view-model.test.ts` | metric → presentation mapping, statuses, locale, thresholds |
| `test/renderer.test.ts` | draw calls, theme tokens used, emitted regions, hidden sections, pending frame |
| `test/element.test.ts` (jsdom) | upgrade, shadow DOM, config/attributes, action dispatch, teardown |

Copy the helpers from `packages/server-monitor/test/helpers/fake-ctx.ts` — a recording canvas double
is all you need to unit-test painters.

## 5. Docs & gallery

- Add the widget to the demo app as a second tab/stage, or create `apps/<widget>-demo`.
- Add a row to the README feature matrix and the roadmap checkbox.
- Document its sections and tokens in `docs/design-system.md` if it introduces new visual patterns.
