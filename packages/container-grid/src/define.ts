import { ContainerGridElement } from './element';

/** Registers the custom element; safe to call multiple times. */
export function defineContainerGrid(tag = ContainerGridElement.tagName): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(tag)) return;
  customElements.define(tag, ContainerGridElement);
  // Friendly alias so both `<container-grid>` and `<widgets-container-grid>` work.
  const alias = tag === 'container-grid' ? 'widgets-container-grid' : 'container-grid';
  if (!customElements.get(alias)) customElements.define(alias, class extends ContainerGridElement {});
}

/** Attribute surface, mirrored for React/Vue/Svelte typings. */
export interface ContainerGridAttributes {
  src?: string;
  transport?: 'auto' | 'http' | 'websocket' | 'sse';
  theme?: 'dark' | 'light';
  locale?: string;
  columns?: '1' | '2';
  interval?: number;
  /** Comma separated phases, e.g. `failed,pending`. */
  phase?: string;
  /** Comma separated namespaces, e.g. `payments,edge`. */
  namespace?: string;
  query?: string;
  attention?: 'true' | 'false';
  sort?: 'severity' | 'name' | 'restarts' | 'cpu' | 'memory';
}

declare global {
  interface HTMLElementTagNameMap {
    'container-grid': ContainerGridElement;
    'widgets-container-grid': ContainerGridElement;
  }
}
