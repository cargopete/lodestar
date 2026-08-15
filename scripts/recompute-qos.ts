/**
 * Re-score `indexer_qos_score` history from the raw `qos_daily` rows.
 *
 * Needed after any change to the scoring maths, because the stored rows are snapshots of
 * whatever the formula was on the day the cron ran. Without this, a fixed score applies only
 * from today forward and every sparkline shows a step where the arithmetic changed rather than
 * where the service did.
 *
 * Each day is re-scored with the window THAT day had, so this reconstructs what the score would
 * have said at the time, not what it would say now with hindsight.
 *
 *   pnpm tsx scripts/recompute-qos.ts            # last 30 days
 *   pnpm tsx scripts/recompute-qos.ts 90         # last 90 days
 *   pnpm tsx scripts/recompute-qos.ts 0          # today only, no history
 *
 * Prints the resulting distribution at the end. That is the number to look at before deciding
 * whether DEFAULTS.scale (currently 0.65) still puts the top decile at an A — it was calibrated
 * against the old served-share weighting and has no particular claim to being right now.
 */
import { db } from '../src/lib/db';
import { computeAndStoreQosScores } from '../src/lib/qos-aggregate';

const GRAPH_EPOCH_DAYS = 18613;

function percentiles(xs: number[]): string {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const band = (lo: number, hi: number) => s.filter((q) => q >= lo && q < hi).length;
  return [
    `n=${s.length}`,
    `p10=${at(0.1).toFixed(1)}`,
    `median=${at(0.5).toFixed(1)}`,
    `p90=${at(0.9).toFixed(1)}`,
    `max=${s[s.length - 1].toFixed(1)}`,
    `at-cap=${s.filter((q) => q > 99.5).length}`,
    `| A=${band(75, 1e9)} B=${band(60, 75)} C=${band(45, 60)} D=${band(30, 45)} F=${band(0, 30)}`,
  ].join('  ');
}

async function main() {
  if (!db) throw new Error('no db — set DATABASE_URL');

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry');
  const scaleArg = args.find((a) => a.startsWith('--scale='));
  const scale = scaleArg ? Number(scaleArg.slice('--scale='.length)) : undefined;
  if (scaleArg && (!Number.isFinite(scale!) || scale! <= 0)) throw new Error(`bad scale: ${scaleArg}`);
  const days = Number(args.find((a) => !a.startsWith('--')) ?? 30);
  if (!Number.isFinite(days) || days < 0) throw new Error(`bad day count: ${args[0]}`);

  const today = Math.floor(Date.now() / 86400000) - GRAPH_EPOCH_DAYS;

  // Calibration: score today at one or more candidate divisors and print what each does to the
  // spread, writing nothing. `scale` is a display constant — it changes every published grade
  // and no indexer's actual service — so it gets chosen against a real distribution, in the open.
  if (dryRun) {
    const candidates = scale ? [scale] : [1, 0.85, 0.75, 0.65, 0.55];
    for (const s of candidates) {
      const r = await computeAndStoreQosScores(db, { windowDays: 30, dayNumber: today, scale: s, dryRun: true });
      console.log(`scale=${s.toFixed(2)}  ${percentiles(r.qScores)}`);
    }
    await db.end();
    return;
  }

  const start = Date.now();
  let totalScored = 0;

  // Oldest first, so an interrupted run leaves a contiguous stretch of fixed days rather than
  // a fixed today sitting on top of stale history.
  for (let d = today - days; d <= today; d++) {
    const { scored } = await computeAndStoreQosScores(db, { windowDays: 30, dayNumber: d, scale });
    totalScored += scored;
    const date = new Date((d + GRAPH_EPOCH_DAYS) * 86400000).toISOString().slice(0, 10);
    console.log(`${date}  day ${d}  scored ${scored}`);
  }

  const dist = await db<{ band: string; n: number }[]>`
    SELECT CASE
             WHEN q_score >= 75 THEN 'A  75+'
             WHEN q_score >= 60 THEN 'B  60-75'
             WHEN q_score >= 45 THEN 'C  45-60'
             WHEN q_score >= 30 THEN 'D  30-45'
             ELSE                    'F  <30'
           END AS band,
           COUNT(*)::int AS n
    FROM indexer_qos_score
    WHERE day_number = (SELECT MAX(day_number) FROM indexer_qos_score)
    GROUP BY 1 ORDER BY 1
  `;
  console.log(`\n${totalScored} rows in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log('Latest-day distribution:');
  for (const b of dist) console.log(`  ${b.band}  ${b.n}`);

  await db.end();
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
