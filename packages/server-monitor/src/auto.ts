/**
 * Auto-registration entry point.
 *
 * `import '@widgets/server-monitor/auto'` (or a plain `<script>` tag pointing at
 * the IIFE bundle) registers `<server-monitor>` without any boilerplate — the
 * fastest path for WinUI WebView2, Android WebView and WKWebView hosts.
 */
import { defineServerMonitor } from './define';

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => defineServerMonitor(), { once: true });
  } else {
    defineServerMonitor();
  }
}

export { defineServerMonitor };
export * from './index';
