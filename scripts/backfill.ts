/**
 * One-time historical backfill — run after setting up Supabase.
 *
 * Usage:
 *   npx tsx scripts/backfill.ts              # run all steps
 *   npx tsx scripts/backfill.ts epochs       # run a single step
 *   npx tsx scripts/backfill.ts delegations allocations  # run specific steps
 *
 * Requires .env.local (or env vars) with:
 *   GRAPH_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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
    // .env.local not found — expect env vars to be set externally
  }
}

loadEnv();

// ── Dynamic imports (env must be set before these resolve) ─

async function main() {
  const { createClient } = await import('@supabase/supabase-js');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const graphKey = process.env.GRAPH_API_KEY;

  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (!graphKey) {
    console.error('Missing GRAPH_API_KEY');
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });

  // Import ingestion modules (they use relative imports internally)
  const { ingestEpochs } = await import('../src/lib/ingest/epochs.js');
  const { ingestDelegationEvents } = await import('../src/lib/ingest/delegations.js');
  const { ingestAllocations } = await import('../src/lib/ingest/allocations.js');
  const { ingestDisputes } = await import('../src/lib/ingest/disputes.js');

  // Parse CLI args for which steps to run
  const requestedSteps = process.argv.slice(2).map((s) => s.toLowerCase());
  const runAll = requestedSteps.length === 0;
  const shouldRun = (step: string) => runAll || requestedSteps.includes(step);

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Lodestar — Historical Backfill         ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Steps: ${runAll ? 'ALL' : requestedSteps.join(', ')}\n`);

  const results: Record<string, { count: number; durationMs: number; error?: string }> = {};

  // 1. Epochs (~1,200 records, fast)
  if (shouldRun('epochs')) {
    console.log('▸ Epochs: starting...');
    const t = Date.now();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await ingestEpochs(db as any);
      results.epochs = { count: r.ingested, durationMs: Date.now() - t };
      console.log(`  ✓ ${r.ingested} epochs in ${results.epochs.durationMs}ms`);
    } catch (e) {
      results.epochs = { count: 0, durationMs: Date.now() - t, error: String(e) };
      console.error(`  ✗ Epochs failed:`, e);
    }
  }

  // 2. Delegation events (~50K records, medium)
  if (shouldRun('delegations')) {
    console.log('▸ Delegation events: starting...');
    const t = Date.now();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await ingestDelegationEvents(db as any);
      results.delegations = { count: r.ingested, durationMs: Date.now() - t };
      console.log(`  ✓ ${r.ingested} events in ${results.delegations.durationMs}ms`);
    } catch (e) {
      results.delegations = { count: 0, durationMs: Date.now() - t, error: String(e) };
      console.error(`  ✗ Delegation events failed:`, e);
    }
  }

  // 3. Allocations (~500K records, slow — uses backfill mode)
  if (shouldRun('allocations')) {
    console.log('▸ Allocations: starting (this may take 10–15 minutes)...');
    const t = Date.now();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await ingestAllocations(db as any, { backfill: true });
      results.allocations = { count: r.ingested, durationMs: Date.now() - t };
      console.log(`  ✓ ${r.ingested} allocations in ${results.allocations.durationMs}ms`);
    } catch (e) {
      results.allocations = { count: 0, durationMs: Date.now() - t, error: String(e) };
      console.error(`  ✗ Allocations failed:`, e);
    }
  }

  // 4. Disputes (few hundred, fast)
  if (shouldRun('disputes')) {
    console.log('▸ Disputes: starting...');
    const t = Date.now();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await ingestDisputes(db as any);
      results.disputes = { count: r.ingested, durationMs: Date.now() - t };
      console.log(`  ✓ ${r.ingested} disputes in ${results.disputes.durationMs}ms`);
    } catch (e) {
      results.disputes = { count: 0, durationMs: Date.now() - t, error: String(e) };
      console.error(`  ✗ Disputes failed:`, e);
    }
  }

  // Summary
  console.log('\n═══ Backfill Summary ═══');
  for (const [step, r] of Object.entries(results)) {
    const status = r.error ? `FAILED: ${r.error}` : `${r.count} records`;
    console.log(`  ${step}: ${status} (${(r.durationMs / 1000).toFixed(1)}s)`);
  }

  const failed = Object.values(results).some((r) => r.error);
  process.exit(failed ? 1 : 0);
}

main();
