using System;
using System.IO;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace Widgets.ServerMonitor.WinUI;

/// <summary>
/// Hosts the canvas-rendered server monitor inside a WebView2 control.
///
/// Two data paths are supported:
///   1. The widget streams directly from your backend (pass a `wss://` URL).
///   2. The native side owns the credentials and pushes snapshots by invoking
///      <see cref="PushSnapshot"/> — the JSON is handed to the widget through
///      WebView2's host-object bridge.
/// </summary>
public partial class ServerMonitorHost : Window
{
    private const string WidgetBundle = "server-monitor.global.js";

    public ServerMonitorHost()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        var userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Widgets", "WebView2");

        var environment = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
        await View.EnsureCoreWebView2Async(environment);

        var webview = View.CoreWebView2;
        webview.Settings.AreDefaultContextMenusEnabled = false;
        webview.Settings.IsStatusBarEnabled = false;
        webview.Settings.AreBrowserAcceleratorKeysEnabled = false;
        // Everything the widget needs is local: block remote navigation.
        webview.Settings.IsWebMessageEnabled = true;

        webview.WebMessageReceived += (_, args) => HandleWidgetEvent(args.WebMessageAsJson);
        webview.NavigationStarting += (_, args) =>
        {
            if (!args.Uri.StartsWith("file://")) args.Cancel = true;
        };

        webview.SetVirtualHostNameToFolderMapping(
            "widgets.local", Path.Combine(AppContext.BaseDirectory, "web"), CoreWebView2HostResourceAccessKind.DenyCors);

        webview.Navigate("https://widgets.local/index.html");
    }

    /// <summary>
    /// Hands a canonical snapshot to the widget. Call from a timer, a SignalR
    /// handler, an ETW/WMI watcher — anywhere the metrics come from.
    /// </summary>
    public void PushSnapshot(string snapshotJson)
    {
        var escaped = JsonSerializer.Serialize(snapshotJson); // wrap as a JSON string literal
        var script = $"window.__widgets.setSnapshot({escaped});";
        View.CoreWebView2.ExecuteScriptAsync(script);
    }

    /// <summary>Re-subscribe / re-poll the active transport.</summary>
    public void RefreshWidget() => View.CoreWebView2.ExecuteScriptAsync("window.__widgets.refresh();");

    /// <summary>Switch theme or data source without re-creating the control.</summary>
    public void Configure(string configJson) =>
        View.CoreWebView2.ExecuteScriptAsync($"window.__widgets.setConfig({configJson});");

    private void HandleWidgetEvent(string payload)
    {
        // payload: { "type": "widget-action", "action": "logs", "payload": { … } }
        using var document = JsonDocument.Parse(payload);
        if (!document.RootElement.TryGetProperty("action", out var action)) return;

        switch (action.GetString())
        {
            case "logs":
                // e.g. open a local log viewer window bound to the same host
                break;
            case "settings":
                // e.g. open the native settings pane
                break;
            default:
                // forward to your analytics / audit trail
                break;
        }
    }
}
