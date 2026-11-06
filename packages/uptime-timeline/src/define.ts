import { UptimeTimelineElement } from './element';

/** Registers the custom element; safe to call multiple times. */
export function defineUptimeTimeline(tag = UptimeTimelineElement.tagName): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(tag)) return;
  customElements.define(tag, UptimeTimelineElement);
  // Friendly alias so both `<uptime-timeline>` and `<widgets-uptime-timeline>` work.
  const alias = tag === 'uptime-timeline' ? 'widgets-uptime-timeline' : 'uptime-timeline';
  if (!customElements.get(alias)) customElements.define(alias, class extends UptimeTimelineElement {});
}

/** Attribute surface, mirrored for React/Vue/Svelte typings. */
export interface UptimeTimelineAttributes {
  src?: string;
  transport?: 'auto' | 'http' | 'websocket' | 'sse';
  theme?: 'dark' | 'light';
  locale?: string;
  columns?: '1' | '2';
  interval?: number;
  /** Comma separated states, e.g. `major_outage,degraded`. */
  state?: string;
  /** Comma separated groups, e.g. `edge,platform`. */
  group?: string;
  query?: string;
  attention?: 'true' | 'false';
}

declare global {
  interface HTMLElementTagNameMap {
    'uptime-timeline': UptimeTimelineElement;
    'widgets-uptime-timeline': UptimeTimelineElement;
  }
}
