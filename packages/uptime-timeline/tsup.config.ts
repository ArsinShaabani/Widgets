import { defineConfig } from 'tsup';

/**
 * Two outputs, mirroring the other widgets:
 *  - ESM (`index` + `auto`) for bundlers
 *  - IIFE (`uptime-timeline.global.js`) for `<script>` tags inside WebView hosts
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
    entry: { 'uptime-timeline': 'src/auto.ts' },
    format: ['iife'],
    globalName: 'WidgetsUptimeTimeline',
    minify: true,
    sourcemap: true,
    target: 'es2019',
    tsconfig: 'tsconfig.build.json',
    noExternal: ['@widgets/core', '@widgets/render'],
  },
]);
