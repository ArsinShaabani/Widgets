/**
 * Auto-registration entry point.
 *
 * `import '@widgets/log-stream/auto'` (or a `<script>` tag pointing at the IIFE
 * bundle) registers `<log-stream>` without any boilerplate.
 */
import { defineLogStream } from './define';

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => defineLogStream(), { once: true });
  } else {
    defineLogStream();
  }
}

export { defineLogStream };
export * from './index';
