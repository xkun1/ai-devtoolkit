import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    lib: 'src/lib.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  target: 'es2022',
});
