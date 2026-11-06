/**
 * Auto-registration entry point.
 *
 * `import '@widgets/uptime-timeline/auto'` (or a `<script>` tag pointing at the
 * IIFE bundle) registers `<uptime-timeline>` without any boilerplate.
 */
import { defineUptimeTimeline } from './define';

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => defineUptimeTimeline(), { once: true });
  } else {
    defineUptimeTimeline();
  }
}

export { defineUptimeTimeline };
export * from './index';
