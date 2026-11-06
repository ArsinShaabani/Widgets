# Embedding guide

Build the artifact first:

```bash
npm install
npm run build          # → packages/server-monitor/dist/{index.js,auto.js,server-monitor.global.js}
```

Then pick your host. Each folder under [`platforms/`](../platforms) contains a runnable-shaped
implementation, not a snippet dump.

---

## Web / Electron / Tauri

```html
<script type="module" src="./server-monitor.global.js"></script>
<server-monitor src="wss://metrics.example.com/stream" transport="websocket" theme="dark"></server-monitor>
```

```ts
await customElements.whenDefined('server-monitor');
const widget = document.querySelector('server-monitor')!;
widget.setConfig({ locale: 'fa', thresholds: { cpu: { warning: 60, critical: 80 } } });
widget.addEventListener('widget-action', (event) => route((event as CustomEvent).detail.action));
```

See [`platforms/web/index.html`](../platforms/web/index.html).

---

## Windows — WebView2 (WinUI 3, WPF, WinForms)

```csharp
await View.EnsureCoreWebView2Async(await CoreWebView2Environment.CreateAsync(null, cacheFolder));
View.CoreWebView2.SetVirtualHostNameToFolderMapping(
    "widgets.local", Path.Combine(AppContext.BaseDirectory, "web"), CoreWebView2HostResourceAccessKind.DenyCors);
View.CoreWebView2.WebMessageReceived += (_, e) => HandleWidgetEvent(e.WebMessageAsJson);
View.CoreWebView2.Navigate("https://widgets.local/index.html");

// later, from your metrics pipeline:
View.CoreWebView2.ExecuteScriptAsync($"window.__widgets.setSnapshot({json});");
```

Full host: [`platforms/windows/ServerMonitorHost.xaml.cs`](../platforms/windows/ServerMonitorHost.xaml.cs).

---

## Android — WebView + Kotlin bridge

```kotlin
webView.settings.javaScriptEnabled = true
webView.addJavascriptInterface(WidgetBridge(), "AndroidBridge")
webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")

// push a snapshot produced natively
webView.post { webView.evaluateJavascript("window.__widgets.setSnapshot($snapshot)", null) }
```

Full host: [`platforms/android/ServerMonitorActivity.kt`](../platforms/android/ServerMonitorActivity.kt).
`network_security_config.xml` keeps the app TLS-only with a debug-only cleartext exemption.

---

## iOS / iPadOS / macOS — WKWebView

```swift
let controller = WKUserContentController()
controller.add(self, name: "widgets")
let configuration = WKWebViewConfiguration()
configuration.userContentController = controller
let view = WKWebView(frame: .zero, configuration: configuration)
view.loadFileURL(bundleURL, allowingReadAccessTo: bundleURL.deletingLastPathComponent())

// push a snapshot
view.evaluateJavaScript("window.__widgets.setSnapshot(\(json));")
```

Full host + SwiftUI wrapper: [`platforms/ios/ServerMonitorController.swift`](../platforms/ios/ServerMonitorController.swift).

---

## React Native

```tsx
<ServerMonitor snapshot={snapshot} onAction={(action) => navigate(action)} />
```

Full component: [`platforms/react-native/ServerMonitor.tsx`](../platforms/react-native/ServerMonitor.tsx).

---

## Flutter

```dart
ServerMonitorWidget(
  sourceUrl: 'wss://metrics.internal/stream',
  onAction: (action, payload) => Navigator.pushNamed(context, '/$action'),
)
```

Full widget: [`platforms/flutter/server_monitor_widget.dart`](../platforms/flutter/server_monitor_widget.dart).

---

## Choosing a data path

| Situation | Recommendation |
| --- | --- |
| Metrics/logs/fleet endpoint reachable from the page | `<server-monitor src="wss://…">` / `<log-stream …>` / `<container-grid …>` — the widget streams. |
| Mobile app that already holds a token | Keep the token native, call `setSnapshot()` (metrics) or `appendBatch()` (logs, containers) on every push. |
| Server-rendered page | Render the element, then push the first payload. |
| Existing agent speaking its own JSON | Point a transport at it — `normalizeSnapshot` / `normalizeLogSnapshot` / `normalizeContainerSnapshot` map common shapes (including Kubernetes `items` and quantity strings). |
| Unit tests / design work | `source: 'mock'` (or omit `source`) → deterministic synthetic stream. |

## Simulator endpoints

```bash
npm run mock --workspace @widgets/mock-server      # :4310
```

| Endpoint | Shape |
| --- | --- |
| `GET /api/v1/server/metrics` | canonical `WidgetSnapshot` |
| `GET /api/v1/server/metrics?shape=flat` | flat snapshot (`cpu_usage`, `memory_total`, …) |
| `GET /api/v1/server/events` | metrics over SSE |
| `WS /stream` | metrics stream (subscribe/ping protocol) |
| `GET /api/v1/logs` | canonical `LogSnapshot` batch |
| `GET /api/v1/logs?shape=raw` | container-style lines (`severity`, `ts`, `msg`, `container`, `attrs`) |
| `GET /api/v1/logs/events` | logs over SSE |
| `WS /logs/stream` | logs stream (subscribe/ping protocol) |
| `GET /api/v1/containers` | canonical `ContainerSnapshot` |
| `GET /api/v1/containers?shape=k8s` | Kubernetes `items` shape (`metadata`/`status`/`spec`, quantity strings) |
| `GET /api/v1/containers/events` | fleet over SSE |
| `WS /containers/stream` | fleet stream (subscribe/ping protocol) |

### Canonical payload example

```json
{
  "timestamp": 1793982838608,
  "host": { "name": "prod-edge-01", "os": "Ubuntu 24.04 LTS", "platform": "linux", "uptime": 1569601, "ip": "10.24.8.11", "region": "eu-central-1" },
  "cpu": { "usage": 62.4, "perCore": [61.2, 70.8, 55.1], "load": [4.71, 4.32, 3.98], "cores": 16 },
  "memory": { "total": 68719476736, "used": 42949672960, "free": 25769803776, "swapTotal": 8589934592, "swapUsed": 0, "usage": 62.5 },
  "disk": { "total": 1099511627776, "used": 824633720832, "free": 274877906944, "usage": 75, "readBytesPerSec": 12582912, "writeBytesPerSec": 4194304 },
  "network": { "rxBytesPerSec": 419430400, "txBytesPerSec": 89128960, "rxTotal": 0, "txTotal": 0, "latencyMs": 42 },
  "processes": [{ "pid": 1001, "name": "postgres", "cpu": 52.4, "memory": 4294967296 }],
  "alerts": [{ "id": "disk-pressure", "title": "Disk usage high", "severity": "warning", "metric": "disk", "value": 88 }]
}
```

A flat payload works too (`cpu_usage`, `memory_total`, `memory_used`, `disk_usage`,
`network: { rx_bps }`, `processes: [{ pid, name, cpu, rss }]`) — see `normalizeSnapshot` and the mock
server's `?shape=flat` mode. Try both against the built-in simulator:

```bash
npm run mock
curl -s localhost:4310/api/v1/server/metrics | head -c 200     # canonical
curl -s 'localhost:4310/api/v1/server/metrics?shape=flat'      # flat aliases
```

## Events contract

| Event | `detail` | Emitted when |
| --- | --- | --- |
| `widget-snapshot` | `WidgetSnapshot` | a new snapshot arrived from the active transport |
| `widget-alert` | `{ metric, from, to, value }` | a metric crossed a threshold boundary |
| `widget-action` | `{ action, payload }` | a dashboard affordance was activated |
| `widget-error` | `Error` | the transport failed (also surfaced through `onError`) |
| `widget-render` | `{ regions, viewModel, layout }` | a frame was painted (host mirroring / tests) |

## Public API of the elements

`<server-monitor>`:

| Member | Purpose |
| --- | --- |
| `setConfig(config)` | patch config: source, theme, locale, columns, thresholds, sections, callbacks |
| `setSnapshot(snapshot)` | push a metrics snapshot from a native/JS bridge |
| `refresh()` / `stop()` / `start()` / `paint()` | transport control and forced repaint |
| `snapshot`, `viewModel`, `currentLayout`, `hitRegions`, `hostStatus` | last frame state |

`<log-stream>`:

| Member | Purpose |
| --- | --- |
| `setConfig(config)` | patch config: source, theme, locale, columns, filters, follow, sections |
| `appendBatch(snapshot)` / `appendLine(entry)` | push log lines from a native/JS bridge |
| `filter` (get/set) | read or update the severity/service/query filter |
| `selectedId`, `copySelection()`, `clear()` | inspector control |
| `lineCount`, `viewModel`, `currentLayout`, `hitRegions` | last frame state |

`<container-grid>`:

| Member | Purpose |
| --- | --- |
| `setConfig(config)` | patch config: source, theme, locale, columns, sort, filters, sections |
| `appendBatch(snapshot)` | push a fleet snapshot from a native/JS bridge |
| `filter` (get/set) | phases, namespaces, query, `attentionOnly` |
| `selectedId`, `copyState()`, `clear()` | inspector and buffer control |
| `containerCount`, `viewModel`, `currentLayout`, `hitRegions` | last frame state |

All three elements emit `widget-action`, `widget-error`, `widget-render`; `<server-monitor>` also
emits `widget-snapshot` / `widget-alert`, `<log-stream>` emits `widget-snapshot` / `widget-critical` /
`widget-select`, and `<container-grid>` emits `widget-snapshot` / `widget-transition` / `widget-select`.

## Troubleshooting

| Symptom | Cause & fix |
| --- | --- |
| Widget stays in *Connecting* | The endpoint sent only control frames, or the URL is unreachable. Listen to `widget-error`; a `{"type":"subscribed"}` ack is intentionally ignored. |
| `Failed to construct 'WebSocket'` | A custom `socketFactory` must be a constructor — the built-in transports call it with `new`. |
| Everything reads 0 % | The payload had no recognisable metric keys; see the alias list in `normalizeSnapshot`. |
| Blurry canvas | The container needs a real size; the widget matches `devicePixelRatio` (capped at 3). |
| `ws://` blocked on device | TLS policy: add a debug-only cleartext exemption (Android `network_security_config`, iOS ATS exception, Windows loopback exemption). |
| Sections missing | The viewport is too short — inspect `layout.dropped`, raise the container height, or relocate sections with `config.sections`. |

