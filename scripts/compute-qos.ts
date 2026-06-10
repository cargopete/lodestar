import { db } from '../src/lib/db';
import { computeAndStoreQosScores } from '../src/lib/qos-aggregate';
(async () => {
  if (!db) throw new Error('no db');
  const start = Date.now();
  const r = await computeAndStoreQosScores(db, { windowDays: 30 });
  console.log(`scored ${r.scored} indexers for day ${r.dayNumber} in ${Date.now()-start}ms`);
  await db.end(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
