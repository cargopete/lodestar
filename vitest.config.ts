import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    // Default to node; component tests opt into jsdom via a
    // `// @vitest-environment jsdom` docblock at the top of the file.
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      // Logic-tier scope: lib + API routes + hooks. Components/pages are covered
      // by critical-path tests but not measured against the gate (see V4_HARDENING_PLAN.md).
      include: [
        'src/lib/**/*.ts',
        'src/app/api/**/*.ts',
        'src/hooks/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/__tests__/**',
        'src/lib/database.types.ts',
        'src/lib/staking-abi.ts',
        'src/lib/bountyBoard.ts',
      ],
      reporter: ['text-summary', 'lcov'],
      // Ratcheting baseline — set to the current real measured floor so CI passes
      // but never regresses. Raise these as Phase 3 coverage work lands.
      thresholds: {
        statements: 77,
        branches: 68,
        functions: 77,
        lines: 79,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
