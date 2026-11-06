import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Hosts the cross-platform server monitor widget inside a [WebViewWidget].
///
/// Data can stream from the network inside the WebView (`sourceUrl`) or be pushed
/// from Dart with [pushSnapshot] — which is the recommended path on mobile because
/// credentials stay in the app.
class ServerMonitorWidget extends StatefulWidget {
  const ServerMonitorWidget({
    super.key,
    this.sourceUrl,
    this.transport = 'auto',
    this.theme = 'dark',
    this.locale = 'en',
    this.onAction,
    this.onError,
  });

  /// `wss://` or `https://` endpoint. `null` to push snapshots manually.
  final String? sourceUrl;
  final String transport;
  final String theme;
  final String locale;

  /// Called when the user taps a dashboard affordance (logs, settings, …).
  final void Function(String action, Map<String, dynamic>? payload)? onAction;
  final void Function(String message)? onError;

  @override
  State<ServerMonitorWidget> createState() => _ServerMonitorWidgetState();
}

class _ServerMonitorWidgetState extends State<ServerMonitorWidget> {
  late final WebViewController _controller;
  bool _ready = false;
  final List<String> _queue = <String>[];

  static const String _shell = '''
<!doctype html>
<html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<style>html,body{margin:0;height:100%;background:#101725}#m{display:block;width:100vw;height:100vh}</style>
</head><body>
<server-monitor id="m"></server-monitor>
<script src="./server-monitor.global.js"></script>
<script>
  window.__widgets = document.getElementById('m');
  __widgets.addEventListener('widget-action', (e) => Widgets.postMessage(JSON.stringify({type:'action', ...e.detail})));
  __widgets.addEventListener('widget-error', (e) => Widgets.postMessage(JSON.stringify({type:'error', message:String(e.detail)})));
</script>
</body></html>''';

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF101725))
      ..addJavaScriptChannel('Widgets', onMessageReceived: _handleMessage)
      ..loadHtmlString(_shell, baseUrl: 'https://appassets.androidplatform.net/assets/www/');
  }

  void _handleMessage(JavaScriptMessage message) {
    final decoded = jsonDecode(message.message) as Map<String, dynamic>;
    if (decoded['type'] == 'action') {
      widget.onAction?.call(decoded['action'] as String? ?? 'unknown', decoded['payload'] as Map<String, dynamic>?);
    } else if (decoded['type'] == 'error') {
      widget.onError?.call(decoded['message'] as String? ?? 'unknown error');
    }
  }

  /// Serialises every JS call until the page has finished loading.
  void _evaluate(String script) {
    if (_ready) {
      _controller.runJavaScript(script);
      return;
    }
    _queue.add(script);
  }

  /// Applies configuration (theme, locale, source, thresholds…).
  void configure(Map<String, dynamic> config) {
    _evaluate('window.__widgets.setConfig(${jsonEncode(config)});');
  }

  /// Pushes a canonical snapshot produced in Dart.
  void pushSnapshot(Map<String, dynamic> snapshot) {
    _evaluate('window.__widgets.setSnapshot(${jsonEncode(snapshot)});');
  }

  /// Re-subscribe / re-poll the active transport.
  void refresh() => _evaluate('window.__widgets.refresh();');

  /// Stops the data source (call from `AppLifecycleState.paused`).
  void stop() => _evaluate('window.__widgets.stop();');

  @override
  Widget build(BuildContext context) {
    return WebViewWidget(
      controller: _controller
        ..setNavigationDelegate(
          NavigationDelegate(
            onPageFinished: (_) {
              _ready = true;
              configure({
                'source': widget.sourceUrl == null
                    ? null
                    : {'transport': widget.transport, 'url': widget.sourceUrl},
                'theme': widget.theme,
                'locale': widget.locale,
              });
              _evaluate('window.__widgets.__ready = true;');
              for (final script in _queue) {
                _controller.runJavaScript(script);
              }
              _queue.clear();
            },
            onWebResourceError: (error) => widget.onError?.call(error.description),
          ),
        ),
    );
  }
}
