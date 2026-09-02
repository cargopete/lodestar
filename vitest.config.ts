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
      // Ratcheting baseline — the real measured floor, so CI passes but never regresses.
      //
      // Re-ratcheted 2026-09-02 (#18). The previous numbers (82/72/84/84) were themselves a
      // measured floor when they were written, and coverage then fell ~14 points below them,
      // so the gate could not pass and every run was red. Four months of that trained
      // everyone to merge through a failing Test job, which cost the suite whatever value it
      // had: a check that always fails cannot tell you that you broke something.
      //
      // Ratchet history, newest first. These go UP and never down; #18 stays open for the
      // climb back to 84.
      //
      //   2026-09-02  143 files / 1984 tests  71.13 / 64.68 / 72.05 / 72.41
      //               apns, ingest/rav and ingest/qos taken from 0% to ~98%.
      //   2026-09-02  138 files / 1896 tests  68.90 / 62.50 / 69.76 / 70.18
      //               the re-ratchet itself (#18), after four months of an unreachable gate.
      //
      // Set a little under each measurement, so the gate catches the next real regression
      // rather than flapping on rounding.
      thresholds: {
        statements: 70,
        branches: 64,
        functions: 71,
        lines: 72,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
