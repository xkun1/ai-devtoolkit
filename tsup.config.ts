import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    search: 'src/search/public.ts',
    security: 'src/security/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  target: 'es2022',
});
