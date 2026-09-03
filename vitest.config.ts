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
      // The climb is finished. As of the top entry below every metric is back above the gate
      // those old numbers described — 82/72/84/84 — and past it, so the floor is now set from
      // the measurement rather than from that target.
      //
      // Ratchet history, newest first. These go UP and never down.
      //
      //   2026-09-03  175 files / 2581 tests  84.28 / 77.00 / 86.26 / 85.68
      //               refresh selects lockedTokens so self-stake subtracts it (#54). One test that
      //               the query carries the field and a 10,000 GRT lock makes a 200,000 GRT stake
      //               read 190,000; red with the field dropped from the query. Branches read 0.01
      //               lower because the two `?? '0'` fallbacks that hid the defect are gone, which
      //               removes four never-taken branches from the denominator. Floors unchanged.
      //   2026-09-03  175 files / 2580 tests  84.28 / 77.01 / 86.26 / 85.68
      //               api/poi from the nest behind NUTHATCH_POI (nuthatch#1078). Nine tests: the
      //               bytes32-to-CIDv0 encoder round-trips a real deployment and refuses anything
      //               else, the flag off leaves the gateway path and its key gate untouched, the
      //               nest path never consults the key, the overview reaches the consensus
      //               computation in the shape it reads with the deployment hash rebuilt, a Qm
      //               deployment resolves without a lookup, an empty or malformed deployment is a
      //               404, an unready nest is a 503, and no nest origin means no fallback.
      //   2026-09-03  174 files / 2571 tests  84.20 / 76.96 / 86.15 / 85.59
      //               api/payments from two nests behind NUTHATCH_PAYMENTS (nuthatch#1078). Eight
      //               tests: the flag off leaves the gateway path and its key gate untouched, the
      //               nest path never consults the key, a malformed receiver is still refused first,
      //               escrow folds come from the allocations nest and the tally from the horizon
      //               nest, every id is rebuilt in the subgraph's encoding and the aggregate matches
      //               the gateway path's, the receiver filter reaches all three reads, an unready
      //               nest is a 503 with its reason, and no nest origin means no fallback.
      //   2026-09-03  173 files / 2563 tests  84.11 / 76.88 / 86.07 / 85.48
      //               the three nest-switchable cron routes gate on the gateway key only for the
      //               gateway path (lodestar#49, nuthatch#1078). Three tests, one per route, that
      //               the route starts keyless when its flag is on, driven through the environment
      //               with a module reset rather than a mock so the real `nuthatchEnabled` runs;
      //               each goes red with the old gate restored. Floors unchanged: branches +0.04.
      //               (Entry restored in the payments PR: it was lost in that PR's rebase.)
      //   2026-09-03  173 files / 2560 tests  84.11 / 76.84 / 86.07 / 85.48
      //               the Horizon activity feed from two nests behind NUTHATCH_HORIZON_ACTIVITY
      //               (nuthatch#1078). Seven tests: the flag off leaves the gateway path and its key
      //               gate untouched, the nest path never consults the key, no nest origin means no
      //               fallback, delegation events come from the staking nest and provisions from
      //               the horizon nest, the cache holds the newest twenty-five across both with a
      //               provision carrying its real transaction and block, an unready nest leaves the
      //               cache alone, and the cron secret still gates the nest path.
      //   2026-09-03  172 files / 2553 tests  84.00 / 76.78 / 85.79 / 85.40
      //               RAV read from the nest behind NUTHATCH_RAV (nuthatch#1078). Eleven tests: the
      //               subgraph escrow id rebuilt as txHash || LE32(log_index + 1) on four real
      //               vectors, the flag off leaves the subgraph path untouched, the nest path writes
      //               the row the gateway path would have written, a self-collection with no fee
      //               partner keeps a null allocation, a pair whose amounts differ is refused rather
      //               than guessed, a truncated page is refused, an unready nest surfaces its own
      //               reason, the overlap window and the cursor advance, the cursor is left alone
      //               with nothing newer, and backfill pages by (timestamp, tx, log index).
      //   2026-09-03  172 files / 2542 tests  83.94 / 76.69 / 85.74 / 85.33
      //               allocations read from the nest behind NUTHATCH_ALLOCATIONS (nuthatch#1078).
      //               Nine tests: the flag off leaves the subgraph path untouched, the delta reads
      //               active then closed-since-cursor and never the gateway, a first run skips the
      //               closed read exactly like the gateway path, the row shape matches what the
      //               gateway path writes with status folded to open/closed, the cursor advances to
      //               the epoch the nest reports, a truncated read is refused rather than written
      //               as a complete snapshot, an unready nest surfaces its own reason, a missing
      //               epoch refuses to advance the cursor, and backfill pages by id.
      //   2026-09-03  172 files / 2533 tests  83.89 / 76.64 / 85.70 / 85.27
      //               disputes read from the nest behind NUTHATCH_DISPUTES (nuthatch#1078). Seven
      //               tests: the flag off leaves the subgraph path untouched, the nest path maps
      //               every field, `Drawn` translates to `draw`, an *accepted* dispute is refused
      //               rather than written as a zero burn, an unavailable nest surfaces its own
      //               reason, an empty result writes nothing, and the nullable fields carry through
      //               as null. Branches dipped 0.04 on the first pass - the last two tests are what
      //               took it back up rather than a re-baseline.
      //   2026-09-03  172 files / 2526 tests  83.85 / 76.57 / 85.66 / 85.24
      //               the Graph Network subgraph id given one home (nuthatch#1078). Four tests on
      //               the new leaf module, one of which asserts the deployment id appears as a
      //               literal nowhere else in `src/` — the seam #1078 depends on only works if it
      //               is a seam. Floors unchanged: they are the whole-number floor of the
      //               measurement and this moves none of them.
      //   2026-09-02  170 files / 2503 tests  83.64 / 76.27 / 85.53 / 85.02
      //               batch 4 (#18, the last one): the Foghorn hooks, useDismissible, the
      //               remaining Horizon revert explainers, and six routes taken from 0% —
      //               apr-provenance, disassembly/verify, scuttlebutt/stream,
      //               data-services/query, indexer P&L, operator-preflight, network-health
      //               and qos/capture, plus ingest-qos and ingest-rav in the cron matrix.
      //   2026-09-02  160 files / 2292 tests  79.53 / 72.90 / 79.72 / 80.70
      //               the disassembly cluster (WASM parser, sandbox builder, manifest,
      //               scorecard, orchestrator, IPFS, rate limiter), the Redis half of the
      //               cache, and the disassembly + push routes.
      //   2026-09-02  149 files / 2076 tests  73.23 / 66.53 / 74.26 / 74.60
      //               foghorn, sql/receipt and developer-activity taken from 0%.
      //   2026-09-02  143 files / 1984 tests  71.13 / 64.68 / 72.05 / 72.41
      //               apns, ingest/rav and ingest/qos taken from 0% to ~98%.
      //   2026-09-02  138 files / 1896 tests  68.90 / 62.50 / 69.76 / 70.18
      //               the re-ratchet itself (#18), after four months of an unreachable gate.
      //
      // Set a little under each measurement, so the gate catches the next real regression
      // rather than flapping on rounding.
      thresholds: {
        statements: 83,
        branches: 76,
        functions: 85,
        lines: 85,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
