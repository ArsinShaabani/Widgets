# React Native host

`<ServerMonitor />` wraps the same canvas widget in `react-native-webview`, so iOS and
Android render pixel-identical dashboards with zero duplicated chart code.

```bash
npm install react-native-webview
npm install @widgets/server-monitor
```

## Usage

```tsx
import { ServerMonitor } from './ServerMonitor';

export function MetricsScreen() {
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    // Your own authenticated client: REST, GraphQL, gRPC-web…
    const socket = new WebSocket('wss://metrics.internal/stream');
    socket.onmessage = (event) => setSnapshot(JSON.parse(event.data));
    return () => socket.close();
  }, []);

  return (
    <ServerMonitor
      snapshot={snapshot}
      theme="dark"
      onAction={(action) => navigation.navigate(action)}
      onError={(message) => console.warn(message)}
    />
  );
}
```

Two integration modes:

1. **Pushed snapshots** (recommended on mobile) — the app keeps the auth token, the widget
   stays a pure renderer. `snapshot` is applied through `window.__widgets.setSnapshot(…)`.
2. **Streaming inside the WebView** — pass `source="wss://…"` and the widget manages the
   socket, history and reconnects on its own.

## Files

| File | Purpose |
| --- | --- |
| `ServerMonitor.tsx` | Component + inline HTML shell + message bridge. |

## Notes

- The built bundle must be reachable from the WebView: either ship it as a static asset
  (`android/app/src/main/assets/` and an iOS bundle resource) or serve it from the app's
  own asset host.
- `setSupportMultipleWindows={false}` and `scrollEnabled={false}` prevent scroll conflicts
  with the native gesture handlers.
- The view model published by the widget (`widget-render` event) is framework agnostic, so a
  future `react-native-skia` renderer can reuse `buildViewModel()` without any UI rewrite.
