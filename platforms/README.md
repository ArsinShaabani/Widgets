# Platform hosts

The widgets are **web components rendered on canvas**, so one build runs everywhere.
Each folder here is a thin, production-shaped host that shows how to embed a widget
and how to feed it data with native credentials/permissions.

| Host | Folder | Renderer | Data path |
| --- | --- | --- | --- |
| Browser / Electron / Tauri | [`web`](./web) | `<server-monitor>` in the page | `fetch`, `WebSocket`, `EventSource` |
| Windows (WinUI 3 / WPF / WinForms) | [`windows`](./windows) | WebView2 | `CoreWebView2.PostWebMessageAsJson` → `setSnapshot()` |
| Android | [`android`](./android) | `android.webkit.WebView` | `@JavascriptInterface` bridge → `setSnapshot()` |
| iOS / iPadOS / macOS | [`ios`](./ios) | `WKWebView` | `WKScriptMessageHandler` → `setSnapshot()` |
| React Native | [`react-native`](./react-native) | `react-native-webview` | `injectedJavaScript` → `setSnapshot()` |
| Flutter | [`flutter`](./flutter) | `webview_flutter` | `JavaScriptChannel` → `setSnapshot()` |

## Shared contract

Every native host does the same three things:

1. **Load** `server-monitor.global.js` (or the app's HTML shell) inside the WebView.
2. **Push data** — either let the widget stream directly from your backend, or keep the
   credentials on the native side and hand the widget a plain snapshot.
3. **Listen** for `widget-action` / `widget-alert` events and route them to native code.

```js
// Inside the WebView, after the bundle is loaded:
const widget = document.querySelector('server-monitor');
widget.setConfig({ source: 'wss://metrics.internal/stream', theme: 'dark' });
widget.addEventListener('widget-action', (event) => {
  bridge.postMessage(JSON.stringify(event.detail)); // native side opens the dashboard
});
```

```js
// Native side pushing its own credentials-free snapshot:
widget.setSnapshot(snapshotFromNative);
```

## Checklist per platform

- **Windows**: enable `CoreWebView2` (evergreen runtime), expose a `window.chrome.webview` bridge.
- **Android**: `WebView` needs `setJavaScriptEnabled(true)`; a `@JavascriptInterface` bridge must be
  annotated `@JavascriptInterface` and only ever called from the UI thread's JS session.
- **iOS**: `WKWebView` requires `WKScriptMessageHandler`; add the widget host to
  `WKWebViewConfiguration.userContentController`.
- **All**: keep TLS on (`wss://`, `https://`); for plain `ws://`/`http://` dev servers you must opt in
  (Android `usesCleartextTraffic`, iOS ATS exceptions, Windows loopback exemption).

## Building the single-file bundles hosts consume

```bash
npm run build
# → packages/server-monitor/dist/server-monitor.global.js   (IIFE, registers <server-monitor>)
# → packages/log-stream/dist/log-stream.global.js           (IIFE, registers <log-stream>)
# → packages/*/dist/auto.js                                 (ESM auto-registration)
# → packages/*/dist/index.js + index.d.ts                   (bundler entry points)
```

Both widgets are independent bundles: a host can embed just one, or both side by side in the same
WebView (they do not share globals beyond the element registrations).
