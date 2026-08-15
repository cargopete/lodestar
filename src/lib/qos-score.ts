/**
 * QoS quality scoring — pure functions, no I/O (so they're cheap to unit-test and
 * deterministic). The caller (ingest/cron) supplies aggregated per-deployment numbers
 * and per-deployment cohort context; this module turns them into a 0–100 quality score.
 *
 * Design (see plans/qos-scoring-and-network-health.md):
 *  - Reliability = Wilson lower bound on success rate → small samples can't fake a high score.
 *  - Latency utility = exponential decay, normalised per-deployment (τ = cohort median latency).
 *  - Freshness utility = exponential decay on seconds-behind-chain-head.
 *  - Combine as a WEIGHTED PRODUCT per deployment (a near-zero on any axis tanks that
 *    deployment), aggregate across deployments weighted by QUERIES SERVED, then apply
 *    a gentle coverage factor (breadth of deployments served with credible volume).
 *
 * The blend weight was served SHARE (this indexer's slice of a deployment's traffic) until
 * 2026-08-15. That let a deployment where an indexer answered 3 of 3 queries carry weight 1.0
 * while the deployment carrying 4,731 of its queries carried 0.084, so a handful of backwaters
 * outvoted the real workload and the Wilson bound's small-sample penalty then dominated the
 * score. Share measures fairness of routing, not amount of service; it stays on the metrics for
 * reporting and drives ServedGap in qos-aggregate, but it is no longer what the blend weighs.
 *
 * V1 oracle has no p90/p99 or stdev at daily grain, so latency uses avg; when a tail estimate
 * is available (avg + k·stdev) the caller passes it in as `avgLatencyMs`.
 */

// ── Tunables (overridable via opts for testing / empirical calibration) ──────────
export const DEFAULTS = {
  z: 1.96, // Wilson z (95%)
  a: 1, // reliability exponent
  b: 1, // latency exponent
  c: 0.5, // freshness exponent
  // Freshness decay constant (30 min behind ≈ 1/e utility). Was 600s, which is defensible for
  // a 12-second chain and punishing everywhere else: an Arbitrum deployment 5,000 blocks behind
  // is 21 minutes stale and scored 0.12 for it, and the oracle's blocks_behind is a daily mean,
  // so a single bad hour drags the whole day. 1800s keeps a genuinely stuck indexer near zero
  // (2h behind ≈ 0.02) without grading normal L2 jitter as an outage.
  tauFreshSec: 1800,
  halfLifeDays: 10, // EWMA half-life for day weighting
  minCredibleN: 100, // queries/deployment to count toward coverage
  coverageK: 3, // coverage saturation constant
  // Display calibration: the weighted product of sub-1 utilities caps a strong indexer's raw
  // composite well below 1. Dividing by this "excellent reference" stretches the score to the
  // full 0–100 range so the network's best read as A/B (ranking is unchanged — monotonic scale).
  // ≈ the composite an excellent indexer achieves; calibrated so the top decile reads A and the
  // median lands around B/C (keeps A selective rather than inflating the whole field).
  scale: 0.65,
} as const;

// Approximate block times (seconds) by the oracle's chain_id string. Chains the oracle actually
// emits, surveyed against a day of live data on 2026-08-15; roughly 8% of rows were landing on
// names absent from this table, `xdai` (plain alias of gnosis) among them.
const BLOCK_TIME_SEC: Record<string, number> = {
  'mainnet': 12,
  sepolia: 12,
  'arbitrum-one': 0.25,
  arbitrum: 0.25,
  'arbitrum-sepolia': 0.25,
  base: 2,
  'base-sepolia': 2,
  optimism: 2,
  'optimism-sepolia': 2,
  'matic': 2,
  polygon: 2,
  'polygon-zkevm': 2,
  bsc: 3,
  chapel: 3, // BSC testnet
  gnosis: 5,
  xdai: 5,
  avalanche: 2,
  celo: 5,
  fantom: 1,
  sonic: 0.5,
  scroll: 3,
  linea: 2,
  unichain: 1,
  'zksync-era': 1,
  'xlayer-mainnet': 3,
  'blast-mainnet': 2,
  monad: 1,
  moonbeam: 12,
  boba: 2,
  fuse: 5,
  chiliz: 3,
  'chiliz-testnet': 3,
};

/**
 * Seconds per block for the oracle's chain_id, or null when we do not know the chain.
 *
 * Null rather than a 12-second guess. The guess was silently wrong in the expensive direction:
 * a fast-chain deployment a few thousand blocks behind became "hours stale", and exp(-t/tau)
 * turns hours into a flat zero on an axis of the score. Not knowing how to convert blocks to
 * time is not evidence that an indexer is behind, and the caller treats it as absent.
 */
export function blockTimeSec(chainId: string | null | undefined): number | null {
  if (!chainId) return null;
  return BLOCK_TIME_SEC[chainId.toLowerCase()] ?? null;
}

/** Map a 0–100 Q-score to a letter grade + UI badge variant. */
export function qosGrade(q: number): { grade: string; variant: 'success' | 'accent' | 'warning' | 'error' } {
  if (q >= 75) return { grade: 'A', variant: 'success' };
  if (q >= 60) return { grade: 'B', variant: 'accent' };
  if (q >= 45) return { grade: 'C', variant: 'warning' };
  if (q >= 30) return { grade: 'D', variant: 'warning' };
  return { grade: 'F', variant: 'error' };
}

// ── Primitives ───────────────────────────────────────────────────────────────

/**
 * Lower bound of the Wilson score interval for a binomial proportion.
 * Shrinks toward 0 for small n; never collapses to a point at p̂=0 or 1.
 * Returns 0..1. n<=0 → 0 (no evidence).
 */
export function wilsonLowerBound(successes: number, n: number, z: number = DEFAULTS.z): number {
  if (n <= 0) return 0;
  const p = Math.min(1, Math.max(0, successes / n));
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, Math.min(1, (center - margin) / denom));
}

/** Exponential-decay utility in [0,1]. value≥0, tau>0; value=0 → 1, value=tau → 1/e. */
export function decayUtil(value: number, tau: number): number {
  if (tau <= 0) return value <= 0 ? 1 : 0;
  if (value <= 0) return 1;
  return Math.exp(-value / tau);
}

export function latencyUtil(latencyMs: number, tauMs: number): number {
  return decayUtil(Math.max(0, latencyMs), tauMs);
}

export function freshnessUtil(timeBehindSec: number, tauSec: number = DEFAULTS.tauFreshSec): number {
  return decayUtil(Math.max(0, timeBehindSec), tauSec);
}

/** EWMA weight for a datapoint `ageDays` old, given a half-life. ageDays=0 → 1. */
export function ewmaWeight(ageDays: number, halfLifeDays: number = DEFAULTS.halfLifeDays): number {
  if (halfLifeDays <= 0) return ageDays <= 0 ? 1 : 0;
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ── Composite quality ──────────────────────────────────────────────────────────

export interface DeploymentMetrics {
  deployment: string;
  /** EWMA-weighted query count over the window. THE BLEND WEIGHT. */
  n: number;
  /**
   * EWMA-weighted success count (≤ n), or null when the oracle published no success figure
   * for this deployment in the window. Null is excluded from the blend; it is not a zero.
   */
  successes: number | null;
  /** Representative latency (avg, or avg+k·stdev tail when available), ms. */
  avgLatencyMs: number;
  /** Per-deployment cohort latency normaliser (median of peers serving this deployment), ms. */
  latencyTauMs: number;
  /** Seconds behind chain head (blocks_behind × chain block time), or null on an unknown chain. */
  timeBehindSec: number | null;
  /**
   * This indexer's share of the deployment's served queries (0..1). Reported and used for
   * ServedGap; deliberately NOT the blend weight — see the note at the top of this file.
   */
  servedShare: number;
  /**
   * Best reliability any credible peer achieved on this deployment, as a Wilson lower bound so
   * it compares like with like against this row's own. Null when the cohort is too small to say.
   */
  cohortBestReliability?: number | null;
  /**
   * The freshest credible peer's seconds-behind on this deployment, or null when the cohort is
   * too small. A subgraph that has stopped advancing puts every indexer at the same lag, and
   * that lag describes the subgraph.
   */
  cohortFloorTimeBehindSec?: number | null;
}

/**
 * How far below 1 the cohort's best must fall before we grade against it rather than absolutely.
 *
 * The point is a deployment that is degraded for EVERYONE — a mapping that fatals, a halted
 * chain — not a general curve. Where a peer manages 0.95, absolute scoring is fine and grading
 * on a curve would just inflate everybody. Where the best anyone manages is 0.75, an indexer at
 * 0.75 is doing all that can be done and should not be marked down for the subgraph's bug.
 */
export const COHORT_DEGRADED_BELOW = 0.9;

/** Peers with credible volume needed before a cohort figure is trustworthy enough to grade against. */
export const COHORT_MIN_PEERS = 3;

/**
 * Reliability graded against what the cohort proves is achievable on that deployment.
 *
 * Returns the raw bound unchanged unless the deployment is demonstrably degraded for the whole
 * cohort. An indexer that is the worst of a bad bunch still scores badly: dividing 0.0095 by a
 * cohort best of 0.7555 gives 0.013, which is the honest reading of "everyone struggles here and
 * you are eighty times worse than the best of them".
 */
export function cohortAdjustedReliability(r: number, cohortBest: number | null | undefined): number {
  if (cohortBest === null || cohortBest === undefined) return r;
  if (cohortBest >= COHORT_DEGRADED_BELOW || cohortBest <= 0) return r;
  return Math.min(1, r / cohortBest);
}

/**
 * Seconds behind, net of the lag the whole cohort shares.
 *
 * A deployment whose chain has halted, or which has fatally errored at a block, leaves every
 * indexer serving it at the same height while the head runs away. Subtracting the freshest
 * credible peer's lag leaves only the part that is this indexer's own.
 */
export function cohortAdjustedTimeBehind(
  timeBehindSec: number | null,
  cohortFloorSec: number | null | undefined,
): number | null {
  if (timeBehindSec === null) return null;
  if (cohortFloorSec === null || cohortFloorSec === undefined) return timeBehindSec;
  return Math.max(0, timeBehindSec - cohortFloorSec);
}

export interface QualityOpts {
  a?: number;
  b?: number;
  c?: number;
  tauFreshSec?: number;
  minCredibleN?: number;
  coverageK?: number;
  z?: number;
  scale?: number;
}

export interface QualityResult {
  qScore: number; // 0..100
  reliability: number; // 0..1, volume-weighted
  latUtil: number; // 0..1
  /** Null when no deployment in the window had a usable freshness reading. */
  freshUtil: number | null;
  coverage: number; // 0..1
  credibleDeployments: number;
  /** Deployments with volume but no published success figure — excluded from the blend. */
  unmeasuredDeployments: number;
}

/**
 * One deployment's arithmetic, so a score can be explained rather than merely asserted.
 *
 * An indexer reading "F" on a panel with four bars has no way to find out which of its
 * deployments caused it, which is how an operator ends up in a support channel asking us to
 * do it for them.
 */
export interface DeploymentContribution {
  deployment: string;
  /** Blend weight: queries served, EWMA-weighted. */
  n: number;
  /** Fraction of the composite this deployment accounts for (0..1). */
  weight: number;
  /** Raw Wilson lower bound, before any cohort adjustment. */
  reliability: number | null;
  /** What the score actually used. Differs only on cohort-degraded deployments. */
  reliabilityUsed: number | null;
  cohortBestReliability: number | null;
  latUtil: number;
  freshUtil: number | null;
  timeBehindSec: number | null;
  /** Seconds behind net of the cohort floor — the part that is this indexer's own. */
  timeBehindOwnSec: number | null;
  servedShare: number;
  /** The per-deployment weighted product, 0..1. Null when nothing was measured. */
  q: number | null;
  measured: boolean;
}

/**
 * Combine per-deployment QoS into a single quality score.
 *
 * Per deployment: q_d = R^a · U_lat^b · U_fresh^c  (weighted product — any near-zero axis tanks it).
 * Aggregate: QUERY-VOLUME-weighted mean of q_d across deployments.
 * Coverage: gentle [0.5,1] factor rewarding breadth of credibly-served deployments.
 * qScore = 100 · aggregate · coverage.
 *
 * Deployments with no success figure are dropped from the blend, and the freshness factor is
 * omitted (rather than scored zero) where the chain is unknown, so a missing measurement costs
 * an indexer that component instead of convicting it on one.
 */
export function computeQuality(rows: DeploymentMetrics[], opts: QualityOpts = {}): QualityResult {
  return computeQualityDetail(rows, opts).result;
}

/**
 * The same computation, plus the per-deployment working.
 *
 * `computeQuality` is this with the working thrown away. The explain endpoint keeps it, so an
 * operator can be shown which deployment cost them the grade instead of being told a number.
 */
export function computeQualityDetail(
  rows: DeploymentMetrics[],
  opts: QualityOpts = {},
): { result: QualityResult; deployments: DeploymentContribution[] } {
  const a = opts.a ?? DEFAULTS.a;
  const b = opts.b ?? DEFAULTS.b;
  const c = opts.c ?? DEFAULTS.c;
  const tauFreshSec = opts.tauFreshSec ?? DEFAULTS.tauFreshSec;
  const minCredibleN = opts.minCredibleN ?? DEFAULTS.minCredibleN;
  const coverageK = opts.coverageK ?? DEFAULTS.coverageK;
  const z = opts.z ?? DEFAULTS.z;
  const scale = opts.scale ?? DEFAULTS.scale;

  let unmeasuredDeployments = 0;
  for (const row of rows) {
    if (row.successes === null || row.n <= 0) unmeasuredDeployments += 1;
  }

  const empty: QualityResult = {
    qScore: 0,
    reliability: 0,
    latUtil: 0,
    freshUtil: null,
    coverage: 0,
    credibleDeployments: 0,
    unmeasuredDeployments,
  };
  if (rows.length === 0) return { result: empty, deployments: [] };

  let wSum = 0;
  let qBlend = 0;
  let rBlend = 0;
  let latBlend = 0;
  let freshBlend = 0;
  let freshWSum = 0;
  let credibleDeployments = 0;
  const deployments: DeploymentContribution[] = [];

  for (const row of rows) {
    const Ulat = latencyUtil(row.avgLatencyMs, row.latencyTauMs);
    // Subtract the lag the whole cohort shares: a halted subgraph drags every indexer on it
    // equally, and that part is the subgraph's, not the operator's.
    const ownTimeBehind = cohortAdjustedTimeBehind(row.timeBehindSec, row.cohortFloorTimeBehindSec);
    // Unknown chain → no freshness reading → the factor is omitted from the product entirely
    // (exponent applied to 1), not defaulted to a guess.
    const Ufresh = ownTimeBehind === null ? null : freshnessUtil(ownTimeBehind, tauFreshSec);

    // No published success figure, or no volume, means nothing was measured here. Scoring it
    // as a zero would read "served everything badly" off a row that says nothing at all.
    if (row.successes === null || row.n <= 0) {
      deployments.push({
        deployment: row.deployment,
        n: row.n,
        weight: 0,
        reliability: null,
        reliabilityUsed: null,
        cohortBestReliability: row.cohortBestReliability ?? null,
        latUtil: Ulat,
        freshUtil: Ufresh,
        timeBehindSec: row.timeBehindSec,
        timeBehindOwnSec: ownTimeBehind,
        servedShare: row.servedShare,
        q: null,
        measured: false,
      });
      continue;
    }

    const R = wilsonLowerBound(row.successes, row.n, z);
    const Rused = cohortAdjustedReliability(R, row.cohortBestReliability);
    const q = Math.pow(Rused, a) * Math.pow(Ulat, b) * (Ufresh === null ? 1 : Math.pow(Ufresh, c));

    // Weight by queries served. See the header note: served share is a fairness measure and
    // weighing by it let three queries outvote a hundred thousand.
    const w = row.n;
    wSum += w;
    qBlend += w * q;
    rBlend += w * Rused;
    latBlend += w * Ulat;
    if (Ufresh !== null) {
      freshBlend += w * Ufresh;
      freshWSum += w;
    }

    if (row.n >= minCredibleN) credibleDeployments += 1;

    deployments.push({
      deployment: row.deployment,
      n: row.n,
      weight: 0, // filled once wSum is known
      reliability: R,
      reliabilityUsed: Rused,
      cohortBestReliability: row.cohortBestReliability ?? null,
      latUtil: Ulat,
      freshUtil: Ufresh,
      timeBehindSec: row.timeBehindSec,
      timeBehindOwnSec: ownTimeBehind,
      servedShare: row.servedShare,
      q,
      measured: true,
    });
  }

  if (wSum <= 0) return { result: empty, deployments };
  for (const d of deployments) d.weight = d.measured ? d.n / wSum : 0;

  const aggregate = qBlend / wSum;
  // Gentle coverage factor in [0.5, 1]: focused-but-honest indexers aren't crushed,
  // but breadth is rewarded and a single self-curated deployment is dampened.
  const coverage = 0.5 + 0.5 * (credibleDeployments / (credibleDeployments + coverageK));

  return {
    result: {
      qScore: Math.min(100, (100 * aggregate * coverage) / scale),
      reliability: rBlend / wSum,
      latUtil: latBlend / wSum,
      freshUtil: freshWSum > 0 ? freshBlend / freshWSum : null,
      coverage,
      credibleDeployments,
      unmeasuredDeployments,
    },
    deployments,
  };
}
