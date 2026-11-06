# Flutter host

`ServerMonitorWidget` embeds the canvas dashboard with `webview_flutter`, so Flutter apps
get the same visuals as the web build — including the responsive single/two column layout.

```yaml
dependencies:
  webview_flutter: ^4.10.0
```

## Usage

```dart
class MetricsPage extends StatefulWidget {
  const MetricsPage({super.key});
  @override
  State<MetricsPage> createState() => _MetricsPageState();
}

class _MetricsPageState extends State<MetricsPage> {
  final _monitorKey = GlobalKey<ServerMonitorWidgetState>();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF101725),
      body: SafeArea(
        child: ServerMonitorWidget(
          key: _monitorKey,
          sourceUrl: 'wss://metrics.internal/stream', // or null + pushSnapshot
          theme: 'dark',
          onAction: (action, payload) {
            if (action == 'logs') Navigator.of(context).pushNamed('/logs');
          },
          onError: (message) => debugPrint('[widgets] $message'),
        ),
      ),
    );
  }
}
```

Pushing snapshots from Dart (keeps credentials in the app):

```dart
_monitorKey.currentState?.pushSnapshot({
  'timestamp': DateTime.now().millisecondsSinceEpoch,
  'host': {'name': 'prod-edge-01', 'os': 'Ubuntu 24.04 LTS', 'platform': 'linux', 'uptime': 1569601},
  'cpu': {'usage': 62.5, 'cores': 16, 'perCore': List.filled(16, 60.0), 'load': [4.7, 4.2, 3.9]},
  'memory': {'total': 68719476736, 'used': 42949672960, 'free': 25769803776, 'swapTotal': 8589934592, 'swapUsed': 0, 'usage': 62.5},
  'disk': {'total': 1099511627776, 'used': 824633720832, 'free': 274877906944, 'usage': 75.0},
  'network': {'rxBytesPerSec': 419430400, 'txBytesPerSec': 89128960},
  'processes': [],
  'alerts': [],
});
```

## Files

| File | Purpose |
| --- | --- |
| `server_monitor_widget.dart` | Widget, JS channel bridge, snapshot/config API. |

## Notes

- Ship `server-monitor.global.js` as a Flutter asset and point `baseUrl` at it
  (`assets/www/`), or serve it from the app's own asset host.
- Call `stop()` from `AppLifecycleState.paused` to release the socket while backgrounded.
- The same `WidgetSource` contract applies: `null` source + `pushSnapshot` works on every
  platform, which keeps the mobile code path identical across Android and iOS.
