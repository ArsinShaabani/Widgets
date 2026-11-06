# Design system

The visual language is derived from the reference dashboard mock-up and centralised in
`packages/core/src/theme.ts`, so the canvas renderer, the native hosts and any future renderer
share one palette.

## Tokens

| Token | Dark | Light | Used by |
| --- | --- | --- | --- |
| `background` | `#151c2b` | `#eef1f7` | canvas backdrop |
| `surface` | `#1e2637` | `#ffffff` | panel fills (plus a 4.5 % white sheen) |
| `surfaceRaised` | `#242e42` | `#f6f8fc` | avatar, icon buttons |
| `border` | `rgba(255,255,255,.08)` | `rgba(21,28,43,.10)` | hairlines |
| `text` / `textMuted` / `textFaint` | `#ffffff` / `#8f9bb3` / `#5f6b83` | `#151c2b` / `#5f6b83` / `#98a2b8` | titles / captions / axis labels |
| `track` | `#2f3950` | `#e2e7f0` | progress tracks, gauge arcs, donut "free" |
| `gradient` | `#b03aec → #7b3fe4 → #3f6cf0` | tuned for light | per-core bar capsules |
| `areaFill` / `areaStroke` | `#0d3f3a`/`#082027` / `#1fd0c4` | `#d6f5f2`/`#eef1f7` / `#0fa8bc` | network area chart |
| `accents[]` | blue, magenta, cyan, violet, amber | same hue family | CPU / memory / disk / secondary segments |
| `status.*` | ok `#1fd0c4`, warning `#f5a524`, critical `#e94b5c`, unknown `#5f6b83` | tuned for light | rings, dots, chips |
| `badge` | `#e94b5c` | `#e94b5c` | alert count badge |

Override anything per instance:

```ts
widget.setConfig({
  theme: 'dark',
  themeOverride: { accents: ['#00b3ff', '#ff3ea5', '#22d3ee'], status: { warning: '#ffb020' } },
});
```

## Sections

The dashboard is assembled from named sections; layouts, hit-testing and the `sections` config all
speak the same ids.

| Section | Column | Content | Maps to |
| --- | --- | --- | --- |
| `cpuBars` | charts | per-core gradient capsules with a % axis | CPU utilisation per logical core |
| `donuts` | charts | three donuts with centre values | memory composition, volume usage, swap |
| `gauges` | charts | three radial gauges with `01/02/03` captions | CPU / memory / disk usage |
| `network` | charts | monotone-cubic area chart with a byte axis | ingress / egress throughput |
| `host` | host | avatar + alert badge, scoreboard, ratios, detail grid | host identity, health, OS/IP/region/latency |
| `badges` | host | three status rings | CPU / memory / disk with status colour |
| `resourceBars` | host | labelled capsule bars with value chips | top processes by CPU |
| `dualBars` | host | dual-segment bars with two chips | user/system, used/cache, read/write |
| `actions` | host | icon row | settings, logs, share, network, location, dashboard |

Every section registers hit regions (`cpu-core-3`, `gauge-cpu`, `donut-memory`, `badge-disk`,
`resource-proc-1138`, `action-logs`, `host-card`, `host-alerts`, …) that drive tooltips, pointer
cursors, click actions and keyboard traversal.

## Chart vocabulary

- **Capsules, not bars.** Bars are rounded at both ends and filled with the vertical
  magenta→indigo→blue gradient; the minimum drawn height is 4 px so a 0 % core stays visible.
- **Donuts** are annuli with a 0.55 inner ratio plus a small inner accent sliver, giving the
  "open" look of the reference design.
- **Gauges** are arcs with a rounded cap, a track underneath and a thin inner ring; the value is
  set in the middle, the indexed caption below.
- **Status rings** (`badges`) draw a full outer ring in the status colour, a lighter inner ring and
  the live value in the centre — the reference design's `01/02/03` buttons wired to real metrics.
- **Area chart** uses PCHIP (monotone cubic) interpolation: no invented peaks, honest ramps.
- **Progress bars** are ghosted tracks with a filled capsule and an optional secondary segment
  (the design's amber overlay), with value chips inline (dual bars) or right-aligned (resource bars).

## Typography

One stack: `Inter, "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`.
Sizes derive from the section size where it matters (gauge values scale with the radius, the host
name scales with the column width), so the dashboard stays legible from 320 px to 4K. Every label
is truncated with an ellipsis (`ellipsize`) instead of overflowing its box.

## Responsiveness

```
width ≥ 720px                     width < 720px
┌──────────────┬──────────┐       ┌────────────────┐
│  charts      │  host    │       │  host card     │
│  cpuBars     │  host    │       │  badges        │
│  donuts      │  badges  │       │  resourceBars  │
│  gauges      │  resBars │       │  gauges        │
│  network     │  dualBar │       │  cpuBars       │
│              │  actions │       │  network       │
└──────────────┴──────────┘       │  donuts · bars │
                                  └────────────────┘
```

- `columns: 1 | 2` forces a layout; otherwise the engine picks two columns at ≥ `breakpoint`.
- Height is distributed by weight with per-section minimums. When it cannot satisfy every minimum,
  sections are dropped by priority (`actions` → `dualBars` → `resourceBars` → …) and the dropped
  list is reported in the layout result, so a host can surface them elsewhere.
- Padding and gaps shrink below 520 px; the host element is fully fluid (`display: block`, 100 %).

## Accessibility

- The canvas is `role="img"` with an `aria-label` ("*host* server resource monitor") and an
  `aria-description` summary (CPU/memory/disk/health/alerts) that updates with the data.
- A visually hidden `aria-live="polite"` region announces threshold changes and the tooltip text of
  the region the keyboard has focused.
- Keyboard: `Tab` focuses the canvas, `←/→/↑/↓` move between regions (announced), `Enter`/`Space`
  activate the focused affordance, `Escape` clears the selection.
- Pointer hover shows the same tooltip text that the keyboard path announces, so both input models
  expose identical information.
- Contrast: text colours are chosen against `surface` in both themes; status colours are used for
  fills and rings but always paired with a label, never as the only signal.

