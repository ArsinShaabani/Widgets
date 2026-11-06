import { LogStreamElement } from './element';

/** Registers the custom element; safe to call multiple times. */
export function defineLogStream(tag = LogStreamElement.tagName): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(tag)) return;
  customElements.define(tag, LogStreamElement);
  // Friendly alias so both `<log-stream>` and `<widgets-log-stream>` work.
  const alias = tag === 'log-stream' ? 'widgets-log-stream' : 'log-stream';
  if (!customElements.get(alias)) customElements.define(alias, class extends LogStreamElement {});
}

/** Attribute surface, mirrored for React/Vue/Svelte typings. */
export interface LogStreamAttributes {
  src?: string;
  transport?: 'auto' | 'http' | 'websocket' | 'sse';
  theme?: 'dark' | 'light';
  locale?: string;
  columns?: '1' | '2';
  interval?: number;
  /** Comma separated levels, e.g. `error,fatal`. */
  level?: string;
  /** Comma separated services, e.g. `api-gateway,worker`. */
  service?: string;
  query?: string;
  follow?: 'true' | 'false';
}

declare global {
  interface HTMLElementTagNameMap {
    'log-stream': LogStreamElement;
    'widgets-log-stream': LogStreamElement;
  }
}
