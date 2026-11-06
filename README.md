# Widgets

<div align="center">

**A collection of cross-platform UI widgets that read live data from the network.**

One codebase → web, Windows, Android, iOS. Canvas-rendered, framework-free, accessibility-aware.

<img src="docs/images/server-monitor-dark.png" alt="Server monitor widget — dark theme" width="880" />

<sub>First widget: <code>&lt;server-monitor&gt;</code> — live server resource dashboard. Also available in <a href="docs/images/server-monitor-light.png">light theme</a> and <a href="docs/images/server-monitor-mobile.png">single-column layout</a>.</sub>

</div>

---

## Why this exists

Dashboards usually get rewritten once per platform: a React app for the web, a XAML view for
Windows, a Compose screen for Android and a SwiftUI view for iOS. This repository takes the
other route — **one widget implementation, four+ host environments**:

| Layer | Package | Runs on |
| --- | --- | --- |
| Data + domain logic | [`@widgets/core`](packages/core) | Node, browser, React Native, native bridges (no DOM access) |
| Shared canvas kit | [`@widgets/render`](packages/render) | any renderer: geometry, hit-testing, glyphs, primitives, a test canvas double |
| Widgets (rendering + interaction) | [`@widgets/server-monitor`](packages/server-monitor) | `<server-monitor>` web component, canvas 2D |
| Native hosts | [`platforms/`](platforms) | WinUI/WebView2, Android WebView, WKWebView, React Native, Flutter |

Because the visual layer is a **web component painted on canvas inside a WebView**, every host
gets identical pixels, identical animations and identical interaction semantics — while the data
layer stays transport-agnostic (`WebSocket`, `SSE`, HTTP polling, or a snapshot pushed by native code).

## Features

- **Live by design** — WebSocket, Server-Sent Events, HTTP polling and in-process mock streams behind one interface.
- **Self-healing connections** — exponential backoff with jitter, heartbeats, visibility-aware polling, control-frame suppression.
- **Tolerant ingestion** — accepts a canonical snapshot *or* flat/snake_case payloads (`cpu_usage`, `memory_total` …) and refuses control frames that would blank a dashboard.
- **Real monitoring semantics** — rolling history buffers, per-metric thresholds, health score + letter grade, derived alerts, cross-threshold event emission.
- **Designed, not default-styled** — a full design-token system (dark + light) mapped from the reference mock-up: gradient capsules, donuts, radial gauges, monotone-cubic area chart, status rings and a host card.
- **Responsive layout engine** — two-column dashboard at ≥ 720 px, single column below, sections dropped by priority when height is scarce (pure maths, unit-tested).
- **Accessible & keyboard operable** — canvas exposed via `role="img"` + live region, arrow-key navigation across regions, announced tooltips.
- **Zero runtime dependencies** — no chart library, no framework, ~76 KB minified IIFE including the data layer.
- **Tested** — 72 unit tests over transports, normalisation, metrics, geometry, layout, view model, renderer and the element lifecycle (jsdom + a canvas double).

## Quick start

```bash
npm install

# terminal 1 — synthetic metrics server (HTTP + SSE + WebSocket)
npm run mock

# terminal 2 — interactive playground
npm run demo          # → http://127.0.0.1:5173
```

The playground needs no backend at all: pick **Mock (in-process)** as the data source and the
widget streams synthetic-but-realistic metrics.

### Use it in a page

```html
<script type="module" src="./server-monitor.global.js"></script>

<server-monitor
  src="wss://metrics.example.com/stream"
  transport="websocket"
  theme="dark"
  locale="en"
></server-monitor>
```

### Use it from code

```ts
import { defineServerMonitor } from '@widgets/server-monitor';
import type { ServerMonitorElement } from '@widgets/server-monitor';

defineServerMonitor();

const widget = document.createElement('server-monitor') as ServerMonitorElement;
widget.style.cssText = 'display:block;width:100%;height:820px';
widget.setConfig({
  source: { transport: 'websocket', url: 'wss://metrics.example.com/stream' },
  theme: 'dark',
  thresholds: { cpu: { warning: 65, critical: 85 }, disk: { warning: 78, critical: 90 } },
  sections: { dualBars: true },
  onAction: (action, payload) => console.log(action, payload),
});
document.body.append(widget);
```

### Push snapshots from a native host

```js
// Inside the WebView, after `server-monitor.global.js` has loaded:
window.__widgets = document.querySelector('server-monitor');
window.__widgets.setSnapshot(snapshotFromNative); // same pipeline as a live feed
```

## Repository layout

```
packages/
  core/                @widgets/core — contracts, transports, stores, thresholds, formatting, tokens, i18n, source resolution
  render/              @widgets/render — shared canvas kit: geometry, hit regions, glyphs, primitives, test canvas double
  server-monitor/      @widgets/server-monitor — <server-monitor> element, layout engine, canvas renderers
apps/
  mock-server/         synthetic metrics over HTTP / SSE / WebSocket
  demo/                Vite playground (source switch, theme, locale, section toggles)
platforms/             web · windows · android · ios · react-native · flutter host shells
scripts/               bundle smoke test for the shipped IIFE artifact
docs/                  architecture, design system, embedding and widget-authoring guides
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run build` | Builds `core` then `server-monitor` (ESM + dts + IIFE bundle). |
| `npm test` | Runs the full Vitest suite. |
| `npm run typecheck` | Type-checks every package and app. |
| `npm run mock` | Starts the synthetic metrics server on `:4310`. |
| `npm run demo` | Starts the Vite playground on `:5173`. |
| `node scripts/serve-bundle.mjs` | Serves the shipped bundle with a harness (bundle smoke test). |

## Documentation

- [Architecture](docs/architecture.md) — layers, data flow, contracts, why canvas inside a WebView.
- [Design system](docs/design-system.md) — tokens, section anatomy, chart vocabulary, responsiveness.
- [Embedding guide](docs/embedding.md) — web, Windows, Android, iOS, React Native, Flutter.
- [Authoring a new widget](docs/widget-authoring.md) — how to add widget #2 on top of the existing core.

## Roadmap

- [x] `server-monitor` — CPU / memory / disk / network dashboard
- [ ] `log-stream` — live log tail with severity filters
  - [x] data layer: `LogEntry` contracts, tolerant normalisation, bounded `LogStore` with level/service counters, de-duplication and a rolling histogram
  - [ ] widget: virtualised list, severity/service filters, detail panel
- [ ] `container-grid` — Kubernetes pod / service health cards
- [ ] `uptime-timeline` — incidents and SLA heatmap
- [ ] Native renderers (Compose / SwiftUI) reusing `buildViewModel()`
- [x] Platform work: shared canvas kit extracted to `@widgets/render`, transports and source resolution generalised over any snapshot type

## License

[MIT](LICENSE) © Arsin Shaabani

