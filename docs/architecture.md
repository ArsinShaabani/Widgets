# Architecture

## Layers

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Host shell                                                                │
│  browser · WebView2 (Windows) · android.webkit.WebView · WKWebView ·       │
│  react-native-webview · webview_flutter                                    │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ @widgets/server-monitor — <server-monitor> (web component)          │  │
│  │                                                                     │  │
│  │  element.ts        lifecycle, resize, pointer/keyboard, a11y, events │  │
│  │  layout.ts         pure responsive layout engine → section rects     │  │
│  │  view-model.ts     snapshot + history → labels, values, colours,     │  │
│  │                    statuses (pure, unit-tested)                      │  │
│  │  renderer.ts       frame orchestration + hit regions + tooltips      │  │
│  │  draw/*            per-section painters built on @widgets/render      │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                   ▲                                        │
│                    WidgetSnapshot | LogSnapshot + history                  │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ @widgets/render — canvas kit (pure, DOM-free, testable)             │  │
│  │  geometry · hit regions · glyphs · primitives · fake canvas context │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                   ▲                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ @widgets/core — data layer (no DOM, no framework)                   │  │
│  │  source       any source shape → one DataTransport<T>               │  │
│  │  transport/   Http · WebSocket · SSE · Mock · Static, generic in T  │  │
│  │  normalize    backend payload → canonical snapshot (metrics, logs)  │  │
│  │  stores       MetricStore (history + threshold alerts) · LogStore   │  │
│  │  theme/format/i18n   tokens, formatting, translations               │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

The dependency arrow only ever points **downwards**. Widgets never import transports, and core
never touches the DOM, `window` or `document` — which is what lets a native host (Kotlin, Swift,
C#, Dart) reuse the same contracts and even the same view-model maths.

## Data flow

```
transport ──snapshot──▶ WidgetStore ──update──▶ WidgetConnector ──▶ element.paint()
   ▲                          │                                         │
   │                          ├─ history ring buffers (120 points/series)
   │                          └─ threshold transitions → `widget-alert`
   │                                                                    ▼
   └──────────── backoff / heartbeat / refresh ◀──── buildViewModel() → renderDashboard()
                                                                        │
                                                              hit regions → tooltips, clicks,
                                                                             keyboard actions
```

1. **Ingest** — `BaseTransport.ingest()` normalises whatever arrived. Canonical snapshots pass
   through; flat/snake_case payloads are mapped; control frames (`{"type":"subscribed"}`,
   `{"type":"ping"}`) are rejected so they never blank a live dashboard.
2. **State** — `WidgetStore` keeps the latest snapshot plus bounded history for CPU, memory, disk,
   network in/out and load. It also detects threshold *transitions*, so a host can react to
   "warning → critical" without diffing metrics itself.
3. **Presentation model** — `buildViewModel()` is a pure function: snapshot + history + theme +
   thresholds + translator → every string, number, colour and status a section draws. This is the
   seam that makes a Compose/SwiftUI/Skia renderer a small task instead of a rewrite.
4. **Paint** — the layout engine computes section rectangles for the current viewport, painters
   draw with explicit coordinates, and every interactive element registers a hit region
   (`rect` or `circle`) with a tooltip/action.
5. **Interact** — pointer and keyboard events resolve against the *same* hit regions that were
   drawn, so a region can never be "invisible but clickable".

## Contracts

`WidgetSnapshot` (see `packages/core/src/types.ts`) — the single object every widget renders:

```ts
interface WidgetSnapshot {
  timestamp: number;
  host: { name; os; platform; uptime; ip?; region?; kernel?; avatarUrl? };
  cpu: { usage; perCore[]; load[3]; cores; model?; temperature?; breakdown? };
  memory: { total; used; free; cached?; swapTotal; swapUsed; usage };
  disk: { total; used; free; usage; readBytesPerSec; writeBytesPerSec; partitions[] };
  network: { rxBytesPerSec; txBytesPerSec; rxTotal; txTotal; latencyMs?; interfaces[] };
  processes: ProcessInfo[];
  alerts: AlertInfo[];
  health: { score; grade; label };
}
```

`DataTransport` — the only interface that knows about the network:

```ts
interface DataTransport {
  readonly kind: string;
  readonly status: TransportStatus; // idle | connecting | live | reconnecting | error | closed
  start(): Promise<void>;
  stop(): void;
  subscribe(event, listener): () => void;
  refresh?(): void;
}
```

Because `DataTransport` is this small, a host can substitute anything: an authenticated gRPC-web
client, a SharedWorker broadcast, an IPC channel from a Rust/C++ agent, or a test double.

## Why canvas inside a WebView?

| Option | Cross-platform reach | Fidelity | Effort per platform |
| --- | --- | --- | --- |
| Render each chart natively (XAML / Compose / SwiftUI) | native | drifts quickly | high, forever |
| SVG + CSS in each platform's web view | good | good until animation/DPR get involved | medium |
| **Canvas 2D inside a web view (chosen)** | universal | pixel-identical everywhere | one implementation |

The trade-off we accept: accessibility and text selection need explicit work. That work is done
once, here — `role="img"` + `aria-label`/`aria-description`, a live region that announces changes,
arrow-key traversal of regions, and a `widget-render` event that publishes the view model so a host
can mirror the data into its own accessibility tree when it needs to.

## Robustness rules

- **Never blank the UI on a bad frame.** Unknown/empty payloads are rejected; the last good
  snapshot stays on screen and the connection pill switches to *Reconnecting*.
- **Never hot-loop a dead endpoint.** Backoff is `base × factor^attempt` with ±25 % jitter and a
  ceiling; polling pauses while the document is hidden.
- **Never let one sample invent a spike.** Charts interpolate monotonically (PCHIP), which cannot
  overshoot between samples the way a Catmull-Rom spline can.
- **Never depend on the DOM in core.** Core also runs in Node (the mock server uses it) and in
  native bridges, so `HTMLElement`, `ResizeObserver`, `document` and `Buffer` are all optional.
- **Never drop keys on the floor.** `resolveTheme`, `WidgetStore`, `setConfig` and the
  `sections` switches all accept partial input and merge against documented defaults.

## Testing strategy

| Layer | How it is tested |
| --- | --- |
| Transports | controllable doubles for `fetch`, `WebSocket` and `EventSource`; fake timers for backoff |
| Normalisation | table-driven payload fixtures (canonical, flat, wrapped, control frames) |
| Store / thresholds | history bounds, event emission, status transitions, health score extremes |
| Geometry / layout | pure assertions: tick generation, monotone interpolation, non-overlap, priority dropping |
| View model | metric→presentation mapping, statuses, locale switching, axis derivation |
| Renderer | a recording canvas double asserts draw calls, gradient tokens and emitted regions |
| Element | jsdom: upgrade, shadow DOM, headless fallback, action dispatch, attribute parsing, teardown |

