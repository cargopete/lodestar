/**
 * QoS aggregation glue — turns raw qos_daily / deployment_daily rows into per-indexer
 * quality scores via the pure scoring lib (qos-score.ts), and persists them.
 *
 * The grouping/EWMA logic is split into a pure `aggregateIndexerMetrics` (testable) and a
 * thin DB wrapper `computeAndStoreQosScores`.
 */
import type { DbClient } from './db';
import {
  computeQuality,
  blockTimeSec,
  ewmaWeight,
  median,
  wilsonLowerBound,
  COHORT_MIN_PEERS,
  type DeploymentMetrics,
  type QualityResult,
  DEFAULTS,
} from './qos-score';

export interface QosDailyRow {
  indexer_address: string;
  deployment_id: string;
  day_number: number;
  query_count: number;
  /** Null when the oracle published no success proportion for that day. Not a zero. */
  success_count: number | null;
  avg_latency_ms: number | null;
  blocks_behind: number | null;
  chain_id: string | null;
}

export interface DeploymentTotalRow {
  deployment_id: string;
  total_query_count: number;
}

export interface AggregateOpts {
  todayDayNumber: number;
  halfLifeDays?: number;
  latencyTauMult?: number;
  /** Volume a peer needs before it counts toward a deployment's cohort figures. */
  minCredibleN?: number;
  /**
   * Display calibration divisor (see DEFAULTS.scale). Overridable so the constant can be
   * re-derived against a live distribution instead of guessed: run with scale=1 to see the
   * uncalibrated spread, then pick the divisor that puts the top decile at an A.
   */
  scale?: number;
}

// Latency τ = latencyTauMult × per-deployment cohort median. Using the bare median makes
// every median-latency indexer score exp(-1)≈0.37 by construction, compressing the whole
// score range; 2.5× lifts a median indexer to exp(-0.4)≈0.67 so latency discriminates
// the genuinely slow rather than penalising "average". Tunable.
export const LATENCY_TAU_MULT = 2.5;

interface PerPair {
  indexer: string;
  deployment: string;
  wQuery: number; // Σ ewma·query_count (all days — latency/freshness denominator)
  wQueryMeasured: number; // Σ ewma·query_count over days that published a success figure
  wSuccess: number; // Σ ewma·success_count over those same days
  wLatNumer: number; // Σ ewma·query_count·latency
  wBlocksNumer: number; // Σ ewma·query_count·blocks_behind
  rawQuery: number; // Σ query_count (unweighted, for served share)
  chainId: string | null;
}

/**
 * Pure: group raw daily rows into per-indexer DeploymentMetrics[], applying EWMA day-decay,
 * query-weighted latency/freshness, per-deployment cohort latency τ (median), and served-share.
 */
export function aggregateIndexerMetrics(
  qosRows: QosDailyRow[],
  deploymentTotals: DeploymentTotalRow[],
  opts: AggregateOpts,
): Map<string, DeploymentMetrics[]> {
  const halfLife = opts.halfLifeDays ?? DEFAULTS.halfLifeDays;
  const tauMult = opts.latencyTauMult ?? LATENCY_TAU_MULT;

  // 1. Fold rows into per-(indexer,deployment) EWMA aggregates.
  const pairs = new Map<string, PerPair>();
  for (const r of qosRows) {
    const w = ewmaWeight(opts.todayDayNumber - r.day_number, halfLife);
    const key = `${r.indexer_address}\0${r.deployment_id}`;
    let p = pairs.get(key);
    if (!p) {
      p = {
        indexer: r.indexer_address,
        deployment: r.deployment_id,
        wQuery: 0, wQueryMeasured: 0, wSuccess: 0, wLatNumer: 0, wBlocksNumer: 0, rawQuery: 0,
        chainId: r.chain_id,
      };
      pairs.set(key, p);
    }
    const wq = w * r.query_count;
    p.wQuery += wq;
    // Numerator and denominator must come from the same days, or the Wilson bound is
    // computed over queries whose outcome was never published.
    if (r.success_count !== null && r.success_count !== undefined) {
      p.wQueryMeasured += wq;
      p.wSuccess += w * r.success_count;
    }
    p.wLatNumer += wq * (r.avg_latency_ms ?? 0);
    p.wBlocksNumer += wq * (r.blocks_behind ?? 0);
    p.rawQuery += r.query_count;
    if (!p.chainId && r.chain_id) p.chainId = r.chain_id;
  }

  // 2. Per-deployment cohort latency τ = median of indexers' query-weighted avg latency.
  const latByDeployment = new Map<string, number[]>();
  for (const p of pairs.values()) {
    if (p.wQuery <= 0) continue;
    const lat = p.wLatNumer / p.wQuery;
    (latByDeployment.get(p.deployment) ?? latByDeployment.set(p.deployment, []).get(p.deployment)!).push(lat);
  }
  const tauByDeployment = new Map<string, number>();
  for (const [dep, lats] of latByDeployment) {
    const m = median(lats);
    tauByDeployment.set(dep, m > 0 ? m * tauMult : 1); // leniency multiplier; avoid τ=0
  }

  // 2b. Per-deployment cohort context: the best reliability anyone achieved, and the freshest
  // lag anyone achieved, over peers with credible volume. This is what separates "this indexer
  // is failing" from "this subgraph is failing", and only the second deserves mercy.
  const minCredibleN = opts.minCredibleN ?? DEFAULTS.minCredibleN;
  const cohortR = new Map<string, number[]>();
  const cohortLag = new Map<string, number[]>();
  for (const p of pairs.values()) {
    if (p.wQueryMeasured < minCredibleN) continue;
    const R = wilsonLowerBound(p.wSuccess, p.wQueryMeasured);
    (cohortR.get(p.deployment) ?? cohortR.set(p.deployment, []).get(p.deployment)!).push(R);
    const blockSec = blockTimeSec(p.chainId);
    if (blockSec !== null && p.wQuery > 0) {
      const lag = (p.wBlocksNumer / p.wQuery) * blockSec;
      (cohortLag.get(p.deployment) ?? cohortLag.set(p.deployment, []).get(p.deployment)!).push(lag);
    }
  }
  const cohortBestR = new Map<string, number>();
  for (const [dep, rs] of cohortR) {
    if (rs.length >= COHORT_MIN_PEERS) cohortBestR.set(dep, Math.max(...rs));
  }
  const cohortFloorLag = new Map<string, number>();
  for (const [dep, lags] of cohortLag) {
    if (lags.length >= COHORT_MIN_PEERS) cohortFloorLag.set(dep, Math.min(...lags));
  }

  // 3. Deployment totals (served-share denominator).
  const totalByDeployment = new Map<string, number>();
  for (const d of deploymentTotals) totalByDeployment.set(d.deployment_id, d.total_query_count);

  // 4. Build DeploymentMetrics per indexer.
  const out = new Map<string, DeploymentMetrics[]>();
  for (const p of pairs.values()) {
    if (p.wQuery <= 0) continue;
    const avgLat = p.wLatNumer / p.wQuery;
    const avgBlocks = p.wBlocksNumer / p.wQuery;
    const depTotal = totalByDeployment.get(p.deployment) ?? 0;
    const servedShare = depTotal > 0 ? p.rawQuery / depTotal : 0;
    const measured = p.wQueryMeasured > 0;
    // An unknown chain cannot be converted from blocks to seconds. Reported as absent so the
    // scorer omits the freshness factor rather than inventing a 12-second block.
    const blockSec = blockTimeSec(p.chainId);

    const metric: DeploymentMetrics = {
      deployment: p.deployment,
      // The Wilson denominator is the volume whose outcome we actually know. Where nothing was
      // published, carry total volume so the deployment still shows up as unmeasured.
      n: measured ? p.wQueryMeasured : p.wQuery,
      successes: measured ? p.wSuccess : null,
      avgLatencyMs: avgLat,
      latencyTauMs: tauByDeployment.get(p.deployment) ?? avgLat,
      timeBehindSec: blockSec === null ? null : avgBlocks * blockSec,
      servedShare,
      cohortBestReliability: cohortBestR.get(p.deployment) ?? null,
      cohortFloorTimeBehindSec: cohortFloorLag.get(p.deployment) ?? null,
    };
    (out.get(p.indexer) ?? out.set(p.indexer, []).get(p.indexer)!).push(metric);
  }

  return out;
}

// ── Phase 2: selection-bias (ServedGap) + efficiency ────────────────────────────

export interface AllocationRow {
  indexer_address: string;
  deployment_id: string;
  allocated_grt: number;
}

export interface Phase2Metric {
  /** Mean over allocated deployments of (allocation share − served-query share).
   *  High positive = holds allocation but the gateway routes queries around it
   *  (crowding rewards without serving). The leech signature. Range ~[-1, 1]. */
  servedGap: number;
  /** GRT allocated per useful (successful) query served — capital parked per unit of
   *  real service. High = lots of stake/reward capture for little useful work. */
  efficiency: number;
  successfulQueries: number;
  totalAllocatedGrt: number;
  allocatedDeployments: number;
}

/**
 * Pure: compute ServedGap + efficiency per indexer from active allocations, windowed QoS
 * rows, and per-deployment served-query totals. Keyed by indexers that hold allocations
 * (a leech, by definition, holds allocations to crowd rewards).
 */
export function computePhase2Metrics(
  allocations: AllocationRow[],
  qosRows: QosDailyRow[],
  deploymentTotals: DeploymentTotalRow[],
): Map<string, Phase2Metric> {
  // Allocation aggregates.
  const allocByPair = new Map<string, number>(); // `${ix} ${dep}` → GRT
  const totalAllocByDep = new Map<string, number>();
  const depsByIndexer = new Map<string, Set<string>>();
  for (const a of allocations) {
    const ix = a.indexer_address.toLowerCase();
    const pair = `${ix} ${a.deployment_id}`;
    allocByPair.set(pair, (allocByPair.get(pair) ?? 0) + a.allocated_grt);
    totalAllocByDep.set(a.deployment_id, (totalAllocByDep.get(a.deployment_id) ?? 0) + a.allocated_grt);
    (depsByIndexer.get(ix) ?? depsByIndexer.set(ix, new Set()).get(ix)!).add(a.deployment_id);
  }

  // Served-query aggregates (windowed).
  const servedByPair = new Map<string, number>(); // `${ix} ${dep}` → query_count
  const successByIndexer = new Map<string, number>();
  for (const r of qosRows) {
    const ix = r.indexer_address.toLowerCase();
    servedByPair.set(`${ix} ${r.deployment_id}`, (servedByPair.get(`${ix} ${r.deployment_id}`) ?? 0) + r.query_count);
    // A day with no published success figure contributes no useful queries — and no NaN.
    if (r.success_count !== null && r.success_count !== undefined) {
      successByIndexer.set(ix, (successByIndexer.get(ix) ?? 0) + r.success_count);
    }
  }
  const totalServedByDep = new Map<string, number>();
  for (const d of deploymentTotals) totalServedByDep.set(d.deployment_id, d.total_query_count);

  const out = new Map<string, Phase2Metric>();
  for (const [ix, deps] of depsByIndexer) {
    let gapSum = 0;
    let totalAllocated = 0;
    for (const dep of deps) {
      const alloc = allocByPair.get(`${ix} ${dep}`) ?? 0;
      totalAllocated += alloc;
      const totalAlloc = totalAllocByDep.get(dep) ?? 0;
      const allocShare = totalAlloc > 0 ? alloc / totalAlloc : 0;
      const totalServed = totalServedByDep.get(dep) ?? 0;
      const servedShare = totalServed > 0 ? (servedByPair.get(`${ix} ${dep}`) ?? 0) / totalServed : 0;
      gapSum += allocShare - servedShare;
    }
    const successfulQueries = successByIndexer.get(ix) ?? 0;
    out.set(ix, {
      servedGap: deps.size > 0 ? gapSum / deps.size : 0,
      efficiency: totalAllocated / (successfulQueries + 1),
      successfulQueries,
      totalAllocatedGrt: totalAllocated,
      allocatedDeployments: deps.size,
    });
  }
  return out;
}

export interface IndexerQuality extends QualityResult {
  indexer: string;
}

/** Pure: full pipeline from raw rows → per-indexer quality results. */
export function scoreIndexers(
  qosRows: QosDailyRow[],
  deploymentTotals: DeploymentTotalRow[],
  opts: AggregateOpts,
): IndexerQuality[] {
  const metrics = aggregateIndexerMetrics(qosRows, deploymentTotals, opts);
  const results: IndexerQuality[] = [];
  for (const [indexer, rows] of metrics) {
    results.push({ indexer, ...computeQuality(rows, { scale: opts.scale }) });
  }
  return results;
}

/**
 * Load the window from Postgres, compute per-indexer quality, and upsert into
 * indexer_qos_score at `todayDayNumber`. Returns the number of indexers scored.
 */
export async function computeAndStoreQosScores(
  sql: DbClient,
  opts: { windowDays?: number; dayNumber?: number; scale?: number; dryRun?: boolean } = {},
): Promise<{ scored: number; dayNumber: number; qScores: number[] }> {
  const windowDays = opts.windowDays ?? 30;
  const GRAPH_EPOCH_DAYS = 18613;
  // `dayNumber` lets the recompute script re-score a past day with the window that day actually
  // had, rather than back-dating a row computed from data that did not exist yet.
  const todayDayNumber = opts.dayNumber ?? Math.floor(Date.now() / 86400000) - GRAPH_EPOCH_DAYS;
  const sinceDay = todayDayNumber - windowDays;
  const day = new Date((todayDayNumber + GRAPH_EPOCH_DAYS) * 86400000).toISOString().slice(0, 10);

  // Cast NUMERIC/BIGINT to float8 so postgres.js returns JS numbers, not strings
  // (string '+' would concatenate during in-JS aggregation).
  const qosRows = await sql<QosDailyRow[]>`
    SELECT indexer_address, deployment_id, day_number,
           query_count::float8   AS query_count,
           success_count::float8 AS success_count,
           avg_latency_ms::float8 AS avg_latency_ms,
           blocks_behind::float8  AS blocks_behind,
           chain_id
    FROM qos_daily
    WHERE day_number >= ${sinceDay} AND day_number <= ${todayDayNumber}
  `;
  const deploymentTotals = await sql<DeploymentTotalRow[]>`
    SELECT deployment_id, SUM(total_query_count)::float8 AS total_query_count
    FROM deployment_daily
    WHERE day_number >= ${sinceDay} AND day_number <= ${todayDayNumber}
    GROUP BY deployment_id
  `;

  const scores = scoreIndexers(qosRows, deploymentTotals, { todayDayNumber, scale: opts.scale });
  const qScores = scores.map((s) => s.qScore);
  if (scores.length === 0) return { scored: 0, dayNumber: todayDayNumber, qScores };

  // Phase 2: ServedGap + efficiency from active allocations.
  const allocations = await sql<AllocationRow[]>`
    SELECT indexer_address, deployment_id, SUM(allocated_tokens_grt)::float8 AS allocated_grt
    FROM allocations
    WHERE status = 'open' AND allocated_tokens_grt > 0
    GROUP BY indexer_address, deployment_id
  `;
  const phase2 = computePhase2Metrics(allocations, qosRows, deploymentTotals);

  const rows = scores.map((s) => {
    const p2 = phase2.get(s.indexer);
    return {
      indexer_address: s.indexer,
      day_number: todayDayNumber,
      day,
      reliability: s.reliability,
      lat_util: s.latUtil,
      fresh_util: s.freshUtil,
      coverage: s.coverage,
      served_gap: p2?.servedGap ?? null,
      efficiency: p2?.efficiency ?? null,
      q_score: s.qScore,
    };
  });

  // Calibration runs compute the whole thing and write nothing — the point is to look at the
  // distribution a candidate `scale` produces before it reaches a public grade.
  if (opts.dryRun) return { scored: scores.length, dayNumber: todayDayNumber, qScores };

  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await sql`
      INSERT INTO indexer_qos_score ${sql(rows.slice(i, i + CHUNK))}
      ON CONFLICT (indexer_address, day_number) DO UPDATE SET
        reliability = EXCLUDED.reliability,
        lat_util    = EXCLUDED.lat_util,
        fresh_util  = EXCLUDED.fresh_util,
        coverage    = EXCLUDED.coverage,
        served_gap  = EXCLUDED.served_gap,
        efficiency  = EXCLUDED.efficiency,
        q_score     = EXCLUDED.q_score,
        computed_at = NOW()
    `;
  }

  return { scored: scores.length, dayNumber: todayDayNumber, qScores };
}
