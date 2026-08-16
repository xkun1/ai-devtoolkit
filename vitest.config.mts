import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/server/ui.generated.ts',
        'src/index.ts',
        'src/lib.ts',
      ],
      thresholds: {
        statements: 64,
        branches: 54,
        functions: 70,
        lines: 65,
      },
    },
  },
});
