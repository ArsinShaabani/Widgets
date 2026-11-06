# iOS / iPadOS / macOS host (WKWebView)

The widget runs in `WKWebView`; Swift owns credentials, lifecycle and deep links.

## Files

| File | Purpose |
| --- | --- |
| `ServerMonitorController.swift` | `WKWebView` factory, JS bridge, snapshot push, SwiftUI wrapper. |
| `Info.plist` | ATS configuration (TLS only, no dev exceptions in release). |

## How it works

1. `web/index.html` + `server-monitor.global.js` ship in the app bundle and are loaded
   with `loadFileURL(_:allowingReadAccessTo:)`, so the page can load the bundle without any
   network access.
2. The widget is configured in JS and exposed as `window.__widgets`.
3. `push(snapshotJson:)` runs `window.__widgets.setSnapshot(…)`; the widget updates
   history, health score and alerts exactly like a live feed.
4. Widget affordances arrive through `WKScriptMessageHandler` (`widgets` channel), and the
   `ServerMonitorWidgetView` SwiftUI wrapper drops straight into any screen.

## Notes

- `WKWebView` requires `WKScriptMessageHandler` to be removed before the controller can be
  released (handled in `dismantleUIView`).
- Canvas rendering means no `NSAppTransportSecurity` exceptions are needed: everything the
  widget draws is local. Only your metrics endpoint must be reachable.
- On iPad the widget benefits from Adaptive Layout: `columns=2` above ~720 pt, single column
  below. The widget already handles it automatically.
- Use `widget-tooltips`/`tooltips: false` if you embed the widget inside a scroll view and want
  to avoid pointer conflicts with the native drag gesture.
