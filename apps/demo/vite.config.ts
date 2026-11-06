import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const resolvePath = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
  resolve: {
    // Consume the packages straight from source: instant HMR while iterating on
    // a widget, no build step required.
    alias: {
      '@widgets/core': resolvePath('../../packages/core/src/index.ts'),
      '@widgets/server-monitor': resolvePath('../../packages/server-monitor/src/index.ts'),
    },
  },
  build: {
    target: 'es2021',
    sourcemap: true,
  },
});
