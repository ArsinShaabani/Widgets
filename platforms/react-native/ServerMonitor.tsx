import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { WebView as WebViewType } from 'react-native-webview';

/**
 * `<ServerMonitor />` for React Native.
 *
 * The widget renders inside a WebView, so the exact same canvas dashboard is used
 * on iOS and Android. Data can either stream from the network inside the WebView
 * or be pushed from JS with `setSnapshot` (recommended when the app already owns
 * an authenticated client).
 */

export interface ServerMonitorProps {
  /** `wss://` / `https://` endpoint, or `null` to push snapshots manually. */
  source?: string | null;
  /** Transport used for `source`. Defaults to auto-detection from the URL. */
  transport?: 'auto' | 'http' | 'websocket' | 'sse';
  theme?: 'dark' | 'light';
  locale?: string;
  columns?: 1 | 2;
  /** Canonical snapshot pushed from JS (`widget.setSnapshot`). */
  snapshot?: unknown;
  /** Called when the user taps a dashboard affordance. */
  onAction?: (action: string, payload?: unknown) => void;
  /** Called for transport errors inside the WebView. */
  onError?: (message: string) => void;
  /** Inline HTML that loads the bundled widget script. */
  html?: string;
  style?: StyleProp<ViewStyle>;
}

const DEFAULT_HTML = `<!doctype html>
<html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<style>html,body{margin:0;height:100%;background:#101725}#m{display:block;width:100vw;height:100vh}</style>
</head><body>
<server-monitor id="m"></server-monitor>
<script src="./server-monitor.global.js"></script>
<script>
  window.__widgets = document.getElementById('m');
  window.__post = (payload) => window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  __widgets.addEventListener('widget-action', (event) => __post({ type: 'action', ...event.detail }));
  __widgets.addEventListener('widget-alert', (event) => __post({ type: 'alert', ...event.detail }));
  __widgets.addEventListener('widget-error', (event) => __post({ type: 'error', message: String(event.detail) }));
  document.dispatchEvent(new Event('widgets-ready'));
</script>
</body></html>`;

export function ServerMonitor({
  source = null,
  transport = 'auto',
  theme = 'dark',
  locale = 'en',
  columns,
  snapshot,
  onAction,
  onError,
  html = DEFAULT_HTML,
  style,
}: ServerMonitorProps) {
  const webViewRef = useRef<WebViewType | null>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<string[]>([]);

  const initialConfig = useMemo(
    () =>
      JSON.stringify({
        source: source ? { transport, url: source } : null,
        theme,
        locale,
        ...(columns ? { columns } : {}),
      }),
    [columns, locale, source, theme, transport],
  );

  /** Runs JS inside the WebView, queuing until the page is ready. */
  const inject = (script: string) => {
    if (readyRef.current) {
      webViewRef.current?.injectJavaScript(`${script}; true;`);
    } else {
      pendingRef.current.push(script);
    }
  };

  // Re-configure the widget when props change (no reload needed).
  useEffect(() => {
    inject(`window.__widgets.setConfig(${initialConfig})`);
  }, [initialConfig]);

  // Push snapshots from the app's own data layer.
  useEffect(() => {
    if (snapshot === undefined) return;
    inject(`window.__widgets.setSnapshot(${JSON.stringify(snapshot)})`);
  }, [snapshot]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data) as {
        type: string;
        action?: string;
        message?: string;
      };
      if (payload.type === 'action') onAction?.(payload.action ?? 'unknown');
      if (payload.type === 'error') onError?.(payload.message ?? 'unknown error');
    } catch {
      // Ignore non-JSON frames.
    }
  };

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html }}
        allowFileAccess
        allowFileAccessFromFileURLs
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        onMessage={handleMessage}
        onLoadEnd={() => {
          readyRef.current = true;
          inject(`window.__widgets.setConfig(${initialConfig})`);
          for (const script of pendingRef.current) inject(script);
          pendingRef.current = [];
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101725' },
});

export default ServerMonitor;
