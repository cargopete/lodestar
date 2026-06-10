/**
 * One-off QoS backfill. Run with prod env:
 *   DATABASE_URL=... GRAPH_API_KEY=... node_modules/.bin/tsx scripts/backfill-qos.ts [days]
 */
import { db } from '../src/lib/db';
import { ingestQos } from '../src/lib/ingest/qos';

(async () => {
  if (!db) throw new Error('DATABASE_URL not configured');
  const days = process.argv[2] ? Number(process.argv[2]) : 60;
  const start = Date.now();
  const result = await ingestQos(db, { backfill: true, days });
  console.log(`QoS backfill (${days}d) complete: ingested=${result.ingested} rows in ${Date.now() - start}ms`);
  await db.end();
  process.exit(0);
})().catch((e) => {
  console.error('QoS backfill failed:', e);
  process.exit(1);
});
