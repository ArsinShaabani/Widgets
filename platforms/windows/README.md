# Windows host (WinUI 3 / WPF / WinForms + WebView2)

The widget runs inside **WebView2** (Chromium, evergreen runtime). The native side keeps the
credentials and either lets the widget stream directly or pushes snapshots through the script bridge.

## Files

| File | Purpose |
| --- | --- |
| `ServerMonitorHost.xaml` | XAML surface: a `WebView2` plus a loading ring. |
| `ServerMonitorHost.xaml.cs` | Creates the WebView2 environment, maps local assets, bridges events. |
| `Widgets.ServerMonitor.WinUI.csproj` | Reference project file (WinUI 3 + WebView2). |

## How it works

1. `SetVirtualHostNameToFolderMapping("widgets.local", …)` serves the bundle from disk with a
   proper origin (no `file://` CORS problems) and `NavigationStarting` cancels any remote navigation.
2. The page runs `server-monitor.global.js`, which registers `<server-monitor>`.
3. `PushSnapshot(json)` executes `window.__widgets.setSnapshot(…)` — the bridge uses the same
   code path as a network feed, so history, thresholds and alerts behave identically.
4. Widget events travel back through `WebMessageReceived` (`widget-action`, `widget-alert`).

## Bootstrap snippet (page served to the WebView)

```js
const widget = document.querySelector('server-monitor');
widget.setConfig({ source: null, theme: 'dark', title: 'Edge fleet' });
window.__widgets = widget; // so the host can call setSnapshot / refresh / setConfig
```

## Notes

- Windows 11 ships WebView2; on Windows 10 install the **Evergreen WebView2 Runtime**.
- For a plain WPF/WinForms app use the same flow with `Microsoft.Web.WebView2.Wpf.WebView2`.
- `ws://`/`http://` endpoints need a loopback exemption during development:
  `CheckNetIsolation LoopbackExempt -a -n=YourAppPackageFamilyName`.
