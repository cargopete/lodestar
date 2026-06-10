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
 *    deployment), aggregate across deployments weighted by served-query share, then apply
 *    a gentle coverage factor (breadth of deployments served with credible volume).
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
  tauFreshSec: 600, // freshness decay constant (10 min behind ≈ 1/e utility)
  halfLifeDays: 10, // EWMA half-life for day weighting
  minCredibleN: 100, // queries/deployment to count toward coverage
  coverageK: 3, // coverage saturation constant
} as const;

// Approximate block times (seconds) by the oracle's chain_id string. Default 12s.
const BLOCK_TIME_SEC: Record<string, number> = {
  'mainnet': 12,
  'arbitrum-one': 0.25,
  arbitrum: 0.25,
  base: 2,
  optimism: 2,
  'matic': 2,
  polygon: 2,
  bsc: 3,
  gnosis: 5,
  avalanche: 2,
  celo: 5,
  fantom: 1,
  scroll: 3,
  linea: 2,
};

export function blockTimeSec(chainId: string | null | undefined): number {
  if (!chainId) return 12;
  return BLOCK_TIME_SEC[chainId.toLowerCase()] ?? 12;
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
  /** EWMA-weighted query count over the window. */
  n: number;
  /** EWMA-weighted success count (≤ n). */
  successes: number;
  /** Representative latency (avg, or avg+k·stdev tail when available), ms. */
  avgLatencyMs: number;
  /** Per-deployment cohort latency normaliser (median of peers serving this deployment), ms. */
  latencyTauMs: number;
  /** Seconds behind chain head (blocks_behind × chain block time). */
  timeBehindSec: number;
  /** This indexer's share of the deployment's served queries (0..1). Used as the blend weight. */
  servedShare: number;
}

export interface QualityOpts {
  a?: number;
  b?: number;
  c?: number;
  tauFreshSec?: number;
  minCredibleN?: number;
  coverageK?: number;
  z?: number;
}

export interface QualityResult {
  qScore: number; // 0..100
  reliability: number; // 0..1, served-share-weighted
  latUtil: number; // 0..1
  freshUtil: number; // 0..1
  coverage: number; // 0..1
  credibleDeployments: number;
}

/**
 * Combine per-deployment QoS into a single quality score.
 *
 * Per deployment: q_d = R^a · U_lat^b · U_fresh^c  (weighted product — any near-zero axis tanks it).
 * Aggregate: served-share-weighted mean of q_d across deployments.
 * Coverage: gentle [0.5,1] factor rewarding breadth of credibly-served deployments.
 * qScore = 100 · aggregate · coverage.
 */
export function computeQuality(rows: DeploymentMetrics[], opts: QualityOpts = {}): QualityResult {
  const a = opts.a ?? DEFAULTS.a;
  const b = opts.b ?? DEFAULTS.b;
  const c = opts.c ?? DEFAULTS.c;
  const tauFreshSec = opts.tauFreshSec ?? DEFAULTS.tauFreshSec;
  const minCredibleN = opts.minCredibleN ?? DEFAULTS.minCredibleN;
  const coverageK = opts.coverageK ?? DEFAULTS.coverageK;
  const z = opts.z ?? DEFAULTS.z;

  const empty: QualityResult = {
    qScore: 0,
    reliability: 0,
    latUtil: 0,
    freshUtil: 0,
    coverage: 0,
    credibleDeployments: 0,
  };
  if (rows.length === 0) return empty;

  let wSum = 0;
  let qBlend = 0;
  let rBlend = 0;
  let latBlend = 0;
  let freshBlend = 0;
  let credibleDeployments = 0;

  for (const row of rows) {
    const R = wilsonLowerBound(row.successes, row.n, z);
    const Ulat = latencyUtil(row.avgLatencyMs, row.latencyTauMs);
    const Ufresh = freshnessUtil(row.timeBehindSec, tauFreshSec);
    const q = Math.pow(R, a) * Math.pow(Ulat, b) * Math.pow(Ufresh, c);

    // Weight by served share, with a tiny floor so a row with 0 recorded share
    // (but real volume) still contributes.
    const w = Math.max(row.servedShare, 0) + 1e-9;
    wSum += w;
    qBlend += w * q;
    rBlend += w * R;
    latBlend += w * Ulat;
    freshBlend += w * Ufresh;

    if (row.n >= minCredibleN) credibleDeployments += 1;
  }

  if (wSum <= 0) return empty;

  const aggregate = qBlend / wSum;
  // Gentle coverage factor in [0.5, 1]: focused-but-honest indexers aren't crushed,
  // but breadth is rewarded and a single self-curated deployment is dampened.
  const coverage = 0.5 + 0.5 * (credibleDeployments / (credibleDeployments + coverageK));

  return {
    qScore: 100 * aggregate * coverage,
    reliability: rBlend / wSum,
    latUtil: latBlend / wSum,
    freshUtil: freshBlend / wSum,
    coverage,
    credibleDeployments,
  };
}
