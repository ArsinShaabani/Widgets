import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const resolvePath = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Note: Vite matches aliases by prefix, so the more specific
    // `@widgets/render/testing` entry must come before `@widgets/render`.
    alias: {
      '@widgets/core': resolvePath('./packages/core/src/index.ts'),
      '@widgets/render/testing': resolvePath('./packages/render/src/testing/fake-context.ts'),
      '@widgets/render': resolvePath('./packages/render/src/index.ts'),
      '@widgets/server-monitor': resolvePath('./packages/server-monitor/src/index.ts'),
      '@widgets/log-stream': resolvePath('./packages/log-stream/src/index.ts'),
      '@widgets/container-grid': resolvePath('./packages/container-grid/src/index.ts'),
      '@widgets/uptime-timeline': resolvePath('./packages/uptime-timeline/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['packages/*/src/**/*.ts'],
    },
  },
});
