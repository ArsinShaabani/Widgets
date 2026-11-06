/**
 * Auto-registration entry point.
 *
 * `import '@widgets/container-grid/auto'` (or a `<script>` tag pointing at the
 * IIFE bundle) registers `<container-grid>` without any boilerplate.
 */
import { defineContainerGrid } from './define';

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => defineContainerGrid(), { once: true });
  } else {
    defineContainerGrid();
  }
}

export { defineContainerGrid };
export * from './index';
