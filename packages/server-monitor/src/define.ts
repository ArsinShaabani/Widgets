import { ServerMonitorElement } from './element';

/** Registers the custom element; safe to call multiple times. */
export function defineServerMonitor(tag = ServerMonitorElement.tagName): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(tag)) return;
  customElements.define(tag, ServerMonitorElement);
  // Friendly alias so both `<server-monitor>` and `<widgets-server-monitor>` work.
  const alias = tag === 'server-monitor' ? 'widgets-server-monitor' : 'server-monitor';
  if (!customElements.get(alias)) customElements.define(alias, class extends ServerMonitorElement {});
}

/** React/Vue/Svelte type helpers: the element's attribute surface. */
export interface ServerMonitorAttributes {
  src?: string;
  transport?: 'auto' | 'http' | 'websocket' | 'sse';
  theme?: 'dark' | 'light';
  locale?: string;
  columns?: '1' | '2';
  interval?: number;
  title?: string;
}

declare global {
  interface HTMLElementTagNameMap {
    'server-monitor': ServerMonitorElement;
    'widgets-server-monitor': ServerMonitorElement;
  }
}
