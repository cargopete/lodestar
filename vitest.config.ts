import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/lib/api.ts',
        'src/lib/cache.ts',
        'src/lib/queries.ts',
        'src/lib/enriched.ts',
        'src/lib/feed.ts',
        'src/lib/indexing-status.ts',
        'src/lib/reo-contract.ts',
        'src/lib/subgraph.ts',
        'src/lib/wallet.ts',
      ],
      reporter: ['text', 'text-summary', 'lcov'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
