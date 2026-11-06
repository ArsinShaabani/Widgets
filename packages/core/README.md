# @widgets/core

Framework-agnostic data layer for the Widgets collection. **No DOM, no framework, no runtime
dependencies** — it runs in browsers, Node, React Native and native bridges.

```bash
npm install @widgets/core
```

## What is inside

| Export | Purpose |
| --- | --- |
| `WidgetSnapshot` (+all metric types) | the canonical contract every widget renders |
| `HttpTransport`, `WebSocketTransport`, `SseTransport`, `MockTransport`, `StaticPollTransport` | data sources behind one `DataTransport` interface |
| `normalizeSnapshot` | map canonical *or* flat/snake_case payloads into a snapshot; reject control frames |
| `WidgetStore` | latest snapshot, rolling history (120 points/series), threshold-transition events |
| `WidgetConnector` | glue a transport to a store, with runtime transport swapping |
| `classify`, `computeHealth`, `mergeThresholds`, `defaultThresholds` | status levels, health score + grade |
| `formatBytes`, `formatRate`, `formatPercent`, `formatUptime`, `compactNumber`, `formatLatency`, `niceCeil` | locale-aware formatting |
| `resolveTheme`, `darkTheme`, `lightTheme`, `mixHex`, `withAlpha`, `hexToRgb` | design tokens used by every renderer |
| `createTranslator`, `translations` (en, fa) | tiny i18n with per-instance overrides |
| `createMockSnapshot` | deterministic synthetic metrics for demos and tests |
| `Emitter`, `nextBackoff`, `initialStatus` | the small utilities transports are built from |

## Quick start

```ts
import { WebSocketTransport, WidgetStore, WidgetConnector } from '@widgets/core';

const store = new WidgetStore({ historySize: 120, thresholds: { cpu: { warning: 65, critical: 85 } } });
const connector = new WidgetConnector(new WebSocketTransport({ url: 'wss://metrics.example.com/stream' }), store);

store.on('update', ({ current }) => console.log(current.cpu.usage));
store.on('alert', ({ metric, from, to, value }) => console.warn(`${metric}: ${from} → ${to} (${value})`));

await connector.start();
```

HTTP polling and SSE use the same two lines — only the transport changes:

```ts
import { HttpTransport, SseTransport } from '@widgets/core';

new HttpTransport({ url: 'https://metrics.example.com/api/v1/server/metrics', intervalMs: 2000 });
new SseTransport({ url: 'https://metrics.example.com/api/v1/server/events' });
```

### Backend payloads it already understands

```jsonc
// canonical
{ "cpu": { "usage": 62.4, "perCore": […], "load": [4.7, 4.3, 3.9], "cores": 16 }, "memory": { … }, … }

// flat / snake_case (aliases are matched)
{ "cpu_usage": 62.4, "cpu_cores": 16, "memory_total": 68719476736, "memory_used": 42949672960,
  "disk_usage": 75, "network": { "rx_bps": 419430400, "latency": 42 },
  "processes": [{ "pid": 1001, "name": "postgres", "cpu": 52.4, "rss": 4294967296 }] }

// wrapped
{ "data": { …either of the above… } }

// ignored on purpose (never blanks the UI)
{ "type": "subscribed", "stream": "server-metrics" }
```

## Runtime notes

- Node needs `socketFactory` (e.g. the `ws` package) or `eventSourceFactory` since there is no global
  `WebSocket`/`EventSource`; browsers need nothing.
- `Buffer` is detected by duck typing, so the package compiles without Node type definitions.
- Every transport emits `status` changes (`idle | connecting | live | reconnecting | error | closed`)
  and reconnects with exponential backoff + jitter.

See the [architecture guide](../docs/architecture.md) for the full contract list.
