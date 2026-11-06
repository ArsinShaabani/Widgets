# Android host (WebView + Kotlin bridge)

The widget runs in `android.webkit.WebView`; Kotlin owns the credentials and lifecycle.

## Files

| File | Purpose |
| --- | --- |
| `ServerMonitorActivity.kt` | WebView setup, `@JavascriptInterface` bridge, pause/resume streaming. |
| `activity_server_monitor.xml` | Full-bleed WebView layout. |
| `network_security_config.xml` | TLS-only config with a debug-only cleartext exemption. |
| `build.gradle.kts` | Dependencies for the assets-backed web server and widget bundle. |

## How it works

1. The bundle is served from `https://appassets.androidplatform.net/assets/www/`
   (`WebViewAssetLoader`) so the page has a real HTTPS origin — `fetch`, `WebSocket`
   and `EventSource` all work without the `file://` restrictions.
2. The widget is configured in JS and exposes itself as `window.__widgets`.
3. `pushSnapshot()` calls `evaluateJavascript("window.__widgets.setSnapshot(…)")`;
   the widget then re-renders using the very same pipeline as a live feed.
4. `onPause`/`onResume` call `window.__widgets.stop()/start()` so a backgrounded
   activity never keeps a socket open (battery, quota and Play Store policy).

## Notes

- `WebView` **must** have `javaScriptEnabled = true`; no other permissions are required
  because rendering happens on canvas (no network image loads, no external fonts).
- Keep TLS on. For a local `ws://` development server add the debug-only
  `<domain-config cleartextTrafficPermitted="true">` from `network_security_config.xml`.
- Accessibility: the widget exposes `aria-label`/`aria-description` on its canvas and a
  live region, so TalkBack announces the host summary even though the visuals are canvas-painted.
- On Android 12+ `WebView` runs in a multiprocess mode; the JS bridge is still delivered on
  the UI thread, but keep the `webView.post { … }` wrapper to be safe.
