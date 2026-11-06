import { defineConfig } from 'tsup';

/**
 * Two outputs:
 *  - ESM (`index` + `auto`) for bundlers and `import '@widgets/server-monitor/auto'`
 *  - IIFE (`server-monitor.global.js`) for `<script>` tags inside WebView hosts
 *
 * Both bundles resolve `@widgets/core` from its published declaration file
 * (`tsconfig.build.json`) so the dts rollup never reaches into another package's
 * source tree.
 */
export default defineConfig([
  {
    entry: { index: 'src/index.ts', auto: 'src/auto.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2021',
    tsconfig: 'tsconfig.build.json',
    external: ['@widgets/core', '@widgets/render'],
  },
  {
    entry: { 'server-monitor': 'src/auto.ts' },
    format: ['iife'],
    globalName: 'WidgetsServerMonitor',
    minify: true,
    sourcemap: true,
    target: 'es2019',
    tsconfig: 'tsconfig.build.json',
    noExternal: ['@widgets/core', '@widgets/render'],
  },
]);
