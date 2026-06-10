/**
 * One-off RAV redemption backfill. Run with prod env:
 *   DATABASE_URL=... GRAPH_API_KEY=... node_modules/.bin/tsx scripts/backfill-rav.ts
 */
import { db } from '../src/lib/db';
import { ingestRav } from '../src/lib/ingest/rav';

(async () => {
  if (!db) throw new Error('DATABASE_URL not configured');
  const start = Date.now();
  const result = await ingestRav(db, { backfill: true });
  console.log(`RAV backfill complete: ingested=${result.ingested} in ${Date.now() - start}ms`);
  await db.end();
  process.exit(0);
})().catch((e) => {
  console.error('RAV backfill failed:', e);
  process.exit(1);
});
