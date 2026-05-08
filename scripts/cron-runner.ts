/**
 * Standalone cron runner — runs on the droplet via system cron.
 * No Next.js required. Connects directly to Postgres and subgraph APIs.
 *
 * Usage:
 *   npx tsx scripts/cron-runner.ts refresh        # full enrichment pipeline
 *   npx tsx scripts/cron-runner.ts epochs         # ingest new epochs
 *   npx tsx scripts/cron-runner.ts allocations    # ingest allocations (delta)
 *   npx tsx scripts/cron-runner.ts delegations    # ingest delegation events
 *   npx tsx scripts/cron-runner.ts disputes       # ingest disputes
 *   npx tsx scripts/cron-runner.ts snapshot       # network snapshot
 *
 * Requires .env.local with: GRAPH_API_KEY, DATABASE_URL
 * For refresh: also needs UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Load .env.local before any other imports ──────────────

function loadEnv() {
  try {
    const content = readFileSync(join(process.cwd(), '.env.local'), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env.local not found — expect env vars set externally
  }
}

loadEnv();

// ── Main ──────────────────────────────────────────────────

async function main() {
  const step = process.argv[2]?.toLowerCase();

  if (!step) {
    console.error('Usage: npx tsx scripts/cron-runner.ts <step>');
    console.error('Steps: refresh, epochs, allocations, delegations, disputes, snapshot');
    process.exit(1);
  }

  const pg = await import('postgres');
  const { log } = await import('../src/lib/logger.js');
  const { recordCronRun } = await import('../src/lib/cron-runs.js');

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    log.cron.fatal('Missing DATABASE_URL');
    process.exit(1);
  }
  if (!process.env.GRAPH_API_KEY) {
    log.cron.fatal('Missing GRAPH_API_KEY');
    process.exit(1);
  }

  const sql = pg.default(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  const startedAt = new Date();
  const start = Date.now();

  try {
    let rowsAffected: number | undefined;

    switch (step) {
      case 'refresh': {
        if (!process.env.UPSTASH_REDIS_REST_URL) {
          log.cron.warn('UPSTASH_REDIS_REST_URL not set — skipping Redis write');
        }
        const { refreshIndexers } = await import('../src/lib/refresh.js');
        const result = await refreshIndexers({
          sql,
          writeToRedis: !!process.env.UPSTASH_REDIS_REST_URL,
        });
        rowsAffected = result.count;
        log.cron.info({ step, count: result.count, durationMs: result.durationMs }, 'Step complete');
        break;
      }

      case 'epochs': {
        const { ingestEpochs } = await import('../src/lib/ingest/epochs.js');
        const result = await ingestEpochs(sql);
        rowsAffected = result.ingested;
        log.cron.info({ step, ingested: result.ingested, durationMs: Date.now() - start }, 'Step complete');
        break;
      }

      case 'allocations': {
        const { ingestAllocations } = await import('../src/lib/ingest/allocations.js');
        const result = await ingestAllocations(sql);
        rowsAffected = result.ingested;
        log.cron.info({ step, ingested: result.ingested, durationMs: Date.now() - start }, 'Step complete');
        break;
      }

      case 'delegations': {
        const { ingestDelegationEvents } = await import('../src/lib/ingest/delegations.js');
        const result = await ingestDelegationEvents(sql);
        rowsAffected = result.ingested;
        log.cron.info({ step, ingested: result.ingested, durationMs: Date.now() - start }, 'Step complete');
        break;
      }

      case 'disputes': {
        const { ingestDisputes } = await import('../src/lib/ingest/disputes.js');
        const result = await ingestDisputes(sql);
        rowsAffected = result.ingested;
        log.cron.info({ step, ingested: result.ingested, durationMs: Date.now() - start }, 'Step complete');
        break;
      }

      case 'snapshot': {
        const { writeNetworkSnapshot } = await import('../src/lib/ingest/network-snapshot.js');
        await writeNetworkSnapshot(sql);
        rowsAffected = 1;
        log.cron.info({ step, durationMs: Date.now() - start }, 'Step complete');
        break;
      }

      case 'compute-scores': {
        const { computeMonthlyScores } = await import('../src/lib/scoring/compute.js');
        const now = new Date();
        const result = await computeMonthlyScores(sql, {
          year: now.getUTCFullYear(),
          month: now.getUTCMonth() + 1,
        });
        // Push to Redis so the Vercel frontend can read it
        if (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) {
          const { cacheSet } = await import('../src/lib/cache.js');
          await cacheSet('lodestar:leaderboard:latest', {
            periodStart: result.entries[0]?.period_start,
            periodEnd: result.entries[0]?.period_end,
            computedAt: Date.now(),
            entries: result.entries,
          }, 86400 * 35); // 35 days — refreshed monthly
          log.cron.info({ entries: result.entries.length }, 'Redis: leaderboard scores pushed');
        }
        rowsAffected = result.scored;
        log.cron.info({ step, scored: result.scored, durationMs: Date.now() - start }, 'Step complete');
        break;
      }

      default:
        log.cron.fatal({ step }, 'Unknown step');
        process.exit(1);
    }

    // Record successful run
    await recordCronRun(sql, {
      step,
      startedAt,
      durationMs: Date.now() - start,
      rowsAffected,
      success: true,
    });
  } catch (e) {
    const durationMs = Date.now() - start;
    log.cron.error({ err: e, step, durationMs }, 'Step failed');

    // Record failed run
    await recordCronRun(sql, {
      step,
      startedAt,
      durationMs,
      success: false,
      errorMessage: String(e),
    });

    await sql.end();
    process.exit(1);
  }

  await sql.end();
}

main();
