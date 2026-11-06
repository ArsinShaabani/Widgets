import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'testing/fake-context': 'src/testing/fake-context.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2021',
  tsconfig: 'tsconfig.build.json',
  external: ['@widgets/core'],
});
