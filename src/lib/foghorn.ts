// Foghorn — network-quality judge integration.
// Types + fetchers + presentation helpers for the self-hosted Foghorn API,
// reached through the /api/foghorn/[...path] proxy (which prepends /v1/).

import type { BadgeVariant } from '@/components/ui/Badge';

// ── Response types (match the Foghorn axum API) ──────────────────────────────

export interface FoghornStats {
  total_probes: number;
  total_divergences: number;
  opted_in_indexers: number;
  deployments_covered: number;
  divergence_rate_24h: number;
  probes_24h: number;
  divergences_24h: number;
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface SubScores {
  correctness: number | null;
  availability: number | null;
  freshness: number | null;
  coverage: number | null;
  value: number | null;
}

export interface FoghornIndexer {
  indexer_address: string;
  ens_name: string | null;
  composite: number;
  grade: Grade | 'NR';
  rated: boolean;
  sub_scores: SubScores;
  self_stake_grt: number | null;
  allocation_count: number | null;
  reo_status: string | null;
  qos_query_count: number | null;
  probe_count: number;
  sybil_flag: boolean;
  sybil_cluster_id: string | null;
  verdict_count: number;
  needs_attention: boolean;
  reasons: string[];
}

export interface FoghornIndexersResponse {
  window_days: number;
  indexers: FoghornIndexer[];
  count: number;
}

export interface Verdict {
  indexer_address: string;
  ens_name?: string | null;
  kind: string;
  severity: Severity;
  title: string;
  evidence: Record<string, unknown>;
  window_days: number | null;
  first_seen: string;
  last_seen: string;
}

export interface AttentionItem {
  indexer_address: string;
  ens_name?: string | null;
  self_stake_grt?: number | null;
  reo_status?: string | null;
  kind: string;
  deployment_id: string;
  severity: Severity;
  urgency: number;
  title: string;
  detail: Record<string, unknown>;
  first_seen: string;
  last_seen: string;
}

export interface SybilCluster {
  cluster_id: string;
  confidence: number;
  member_count: number;
  members: string[];
  signals: Record<string, unknown>;
  detected_at?: string;
}

export interface ScoreEntry {
  window_days: number;
  composite: number;
  grade: Grade | 'NR';
  rated: boolean;
  sub_scores: SubScores;
  probe_count: number;
  sybil_flag: boolean;
  reasons: string[];
  computed_at: string;
}

export interface Scorecard {
  indexer_address: string;
  profile: {
    ens_name: string | null;
    url: string | null;
    created_at: number | null;
    self_stake_grt: number | null;
    delegated_grt: number | null;
    allocation_count: number | null;
    query_fees_collected_grt: number | null;
    reo_status: string | null;
    reo_source: string | null;
    lodestar_score: number | null;
    lodestar_grade: string | null;
    qos: {
      query_count: number | null;
      success_rate: number | null;
      latency_ms: number | null;
      blocks_behind: number | null;
    };
  } | null;
  scores: ScoreEntry[];
  verdicts: Verdict[];
  needs_attention: AttentionItem[];
  sybil_cluster: SybilCluster | null;
}

export interface FeedEvent {
  probe_id: string;
  deployment_id: string;
  block_number: number;
  block_hash: string;
  query_category: string;
  dispatched_at: string;
  cluster_count: number;
  indexer_count: number;
  diff_patch_count: number;
}

// ── Fetchers (via the /api/foghorn proxy) ─────────────────────────────────────

async function foghornGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/foghorn/${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    // 503 = not configured, 502 = unreachable, 404 = no data yet
    throw new Error(`Foghorn ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export const fetchFoghornStats = () => foghornGet<FoghornStats>('stats');

export const fetchFoghornIndexers = (window = 30, order: 'asc' | 'desc' = 'desc', limit = 500) =>
  foghornGet<FoghornIndexersResponse>(`indexers?window=${window}&order=${order}&limit=${limit}`);

export const fetchFoghornScorecard = (address: string) =>
  foghornGet<Scorecard>(`indexer/${address.toLowerCase()}/scorecard`);

export const fetchNeedsAttention = (kind?: string) =>
  foghornGet<{ items: AttentionItem[]; count: number }>(
    `needs-attention${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`
  );

/** Batch-resolve deployment IPFS hashes → subgraph display names (dashboard API). */
export const fetchDeploymentNames = async (
  hashes: string[]
): Promise<Record<string, string>> => {
  if (hashes.length === 0) return {};
  const res = await fetch('/api/subgraph-names', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hashes }),
  });
  if (!res.ok) return {};
  const json = await res.json();
  return (json.data ?? {}) as Record<string, string>;
};

export const fetchVerdicts = (params: { kind?: string; severity?: string; limit?: number } = {}) => {
  const q = new URLSearchParams();
  if (params.kind) q.set('kind', params.kind);
  if (params.severity) q.set('severity', params.severity);
  if (params.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  return foghornGet<{ verdicts: Verdict[]; count: number }>(`verdicts${qs ? `?${qs}` : ''}`);
};

export const fetchSybilClusters = () =>
  foghornGet<{ clusters: SybilCluster[]; count: number }>('sybil');

export interface NonDetDeployment {
  deployment_id: string;
  divergent_probes: number;
  total_probes: number;
  divergence_rate: number;
  sample_fields: string[];
  first_seen: string;
  last_seen: string;
}

export const fetchNonDeterministic = () =>
  foghornGet<{ deployments: NonDetDeployment[]; count: number }>('nondeterministic');

export interface DeploymentQosRow {
  indexer_address: string;
  success_rate: number | null; // 0..1
  blocks_behind: number | null;
  query_count: number | null;
}

export const fetchDeploymentQos = (deploymentHash: string) =>
  foghornGet<{ deployment_id: string; indexers: DeploymentQosRow[] }>(
    `deployment/${deploymentHash}/qos`
  );

export interface IndexerAllocationQosRow {
  deployment_id: string;
  success_rate: number | null;
  blocks_behind: number | null;
  query_count: number | null;
}

export const fetchIndexerAllocationsQos = (address: string) =>
  foghornGet<{ indexer_address: string; deployments: IndexerAllocationQosRow[] }>(
    `indexer/${address.toLowerCase()}/allocations-qos`
  );

export const fetchFoghornFeed = (limit = 50) =>
  foghornGet<{ events: FeedEvent[]; count: number }>(`feed?limit=${limit}`);

export interface IndexerQuality {
  indexer_address: string;
  days: number;
  total_probes: number;
  divergent_probes: number;
  divergence_rate: number;
  avg_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  by_deployment: Array<{
    deployment_id: string;
    total_probes: number;
    divergent_probes: number;
    divergence_rate: number;
  }>;
  recent_probes: Array<{
    probe_id: string;
    deployment_id: string;
    query_category: string;
    dispatched_at: string;
    response_hash: string | null;
    divergent: boolean;
  }>;
}

export const fetchIndexerQuality = (address: string) =>
  foghornGet<IndexerQuality>(`indexer/${address.toLowerCase()}/quality`);

// ── Foghorn QoS — measured here, not ingested ────────────────────────────────
//
// Foghorn's own QoS, published in the Edge & Node oracle's schema as a second `gateway_id`.
// The oracle's format carries `gateway_id` on every data point, so this is the format's own
// design for multiple gateways rather than a fork of it.
//
// IMPORTANT for anything rendering `query_count`: it counts PROBES FOGHORN DISPATCHED, not
// organic gateway traffic. It is a statement about Foghorn's cadence, never about an indexer's
// popularity. The API repeats this in `query_count_means` on every response; surface it rather
// than quietly plotting it next to real traffic volumes.

export interface FoghornQosSource {
  source: string;
  gateway_id?: string;
  /** Oracle-fed source only. */
  last_update?: string | null;
  /** Measured source only. */
  last_bucket?: string | null;
  last_computed?: string | null;
  /** Null when a source has never published anything we have seen. */
  age_seconds: number | null;
  /**
   * The cadence this source is actually configured to run at. Staleness must be judged against
   * this, not a fixed number: probing hourly makes a 50-minute age completely normal.
   */
  expected_interval_seconds?: number;
  note: string;
}

/**
 * Realised query fees, settled on Arbitrum.
 *
 * The one economic figure on this page nobody self-reports. Deliberately a separate type from the
 * QoS feed's per-bucket fee fields, which stay null — see the note on the fee row in FIELD_MAPPING.
 */
export interface FoghornQosFees {
  source: string;
  measured_from: string;
  window_days: number;
  means: string;
  total_settlements_indexed: number;
  newest_settlement: string | null;
  indexers: {
    indexer_address: string;
    settlements: number;
    deployments: number;
    payers: number;
    grt_collected: number;
    grt_to_curators: number;
    latest_settlement: string | null;
  }[];
}

/**
 * Divergences carrying signatures on both sides.
 *
 * Distinct from the correctness signal elsewhere on the page, which clusters on a hash we compute.
 * These are the hashes the indexers themselves SIGNED, which is what makes the disagreement
 * checkable by someone who does not trust Lodestar.
 */
export interface FoghornQosConflicts {
  window_days: number;
  count: number;
  means: string;
  not_a_verdict: string;
  how_to_check: string;
  conflicts: {
    probe_id: string;
    deployment_id: string;
    block_number: number | null;
    observed_at: string;
    request_cid: string | null;
    /** How many different answers were signed. Three signers with two answers means two agreed. */
    distinct_answers: number;
    signers: {
      indexer: string | null;
      resolved: boolean;
      response_cid: string | null;
      attestation: unknown;
    }[];
  }[];
}

export const fetchQosConflicts = (days = 7, limit = 50) =>
  foghornGet<FoghornQosConflicts>(`qos/conflicts?days=${days}&limit=${limit}`);

export const fetchQosFees = (days = 30, limit = 200) =>
  foghornGet<FoghornQosFees>(`qos/fees?days=${days}&limit=${limit}`);

export interface FoghornQosStatus {
  checked_at: string;
  sources: FoghornQosSource[];
  /**
   * Paid direct-to-indexer probing, reported as a fact about US.
   *
   * Refusals mean an indexer's tap-agent has not yet observed our escrow deposit. They are excluded
   * from every measurement and grade — they describe our funding, not the operator — but they are
   * shown here, because "we measure 40 indexers directly" and "we tried and 38 turned our money
   * away" are very different claims about how good this oracle is.
   */
  paid_dispatch?: {
    window_hours: number;
    served: number;
    refused_denylisted: number;
    refused_unfunded: number;
    note: string;
  } | null;
}

/** One 5-minute measurement window for one (indexer, deployment). */
export interface FoghornQosBucket {
  indexer_wallet: string;
  subgraph_deployment_ipfs_hash: string;
  bucket_start: string;
  bucket_secs: number;
  gateway_id: string | null;
  chain_id: string | null;
  query_count: number;
  num_indexer_200_responses: number;
  proportion_indexer_200_responses: number;
  avg_indexer_latency_ms: number | null;
  max_indexer_latency_ms: number | null;
  stdev_indexer_latency_ms: number | null;
  /** Percentiles exist only at bucket resolution — they do not recombine into daily figures. */
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  latency_p99_ms: number | null;
  avg_indexer_blocks_behind: number | null;
  max_indexer_blocks_behind: number | null;
  /** Responses comparable against a stake-weighted majority cluster. */
  comparable_count: number;
  divergent_count: number;
  /** Null when nothing was comparable. Do NOT render null as 100%. */
  correctness_rate: number | null;
}

export interface FoghornQosBuckets {
  source: string;
  gateway_id: string;
  method: string;
  query_count_means: string;
  independent_of: string;
  window_hours: number;
  /**
   * How to read the success rate, computed by the API from the actual dispatch mix.
   *
   * Deliberately a string from the server rather than prose in this file. It was prose here, and it
   * said every probe was routed through Edge & Node's gateway — true until direct paid probing was
   * switched on, and silently false afterwards. A caveat that cannot go stale is worth more than a
   * better-worded one that can.
   */
  success_rate_bias?: string;
  /** Split of the window's observations by how they were obtained. Absent on older deployments. */
  dispatch?: {
    paid_direct: number;
    via_gateway: number;
    note: string;
  } | null;
  buckets: FoghornQosBucket[];
}

/** One (indexer, deployment) pair present in BOTH feeds. */
export interface FoghornQosComparePair {
  indexer_address: string;
  deployment_id: string;
  probes: number;
  /** False when the pair had too few probes to contribute to the aggregate error. */
  counted_in_aggregate: boolean;
  foghorn: {
    success_rate: number | null;
    blocks_behind: number | null;
    correctness_rate: number | null;
  };
  oracle: {
    success_rate: number | null;
    blocks_behind: number | null;
    /** Context only — organic queries, not comparable with our probe count. */
    query_count: number | null;
  };
  success_rate_delta: number | null;
  /** Oracle sees ≥99% success while Foghorn measured incorrect data. */
  oracle_blind_spot: boolean;
}

export interface FoghornQosCompare {
  window_days: number;
  min_probes_for_aggregate: number;
  coverage: {
    overlapping_pairs: number;
    foghorn_pairs: number;
    oracle_pairs: number;
    note: string;
  };
  agreement: {
    pairs_in_aggregate: number;
    mean_absolute_success_rate_error: number | null;
    pairs_disagreeing_over_10pct: number;
    oracle_blind_spots: number;
    oracle_blind_spot_means: string;
  };
  not_compared: { query_count: string };
  pairs: FoghornQosComparePair[];
}

export const fetchQosStatus = () => foghornGet<FoghornQosStatus>('qos/status');

export const fetchQosBuckets = (hours = 24, limit = 500) =>
  foghornGet<FoghornQosBuckets>(`qos/buckets?hours=${hours}&limit=${limit}`);

export const fetchQosCompare = (days = 3) =>
  foghornGet<FoghornQosCompare>(`qos/compare?days=${days}`);


// ── Canonical oracle data, mirrored ──────────────────────────────────────────
//
// Edge & Node's OWN published numbers, served from Lodestar's mirror. Unlike the measured feed
// these are real gateway traffic: genuine query counts, genuine fees, success rates over queries
// users actually sent. This is the feed to show first — the probe feed answers a different question.

export interface CanonicalPoint {
  id: string;
  dayNumber: number;
  dayStart: number | null;
  dayEnd: number | null;
  dataPointCount: number | null;
  indexer_wallet: string;
  indexer_url: string | null;
  subgraph_deployment_ipfs_hash: string;
  chain_id: string | null;
  gateway_id: string | null;
  query_count: number | null;
  num_indexer_200_responses: number | null;
  proportion_indexer_200_responses: number | null;
  avg_indexer_latency_ms: number | null;
  max_indexer_latency_ms: number | null;
  avg_indexer_blocks_behind: number | null;
  max_indexer_blocks_behind: number | null;
  avg_query_fee: number | null;
  total_query_fees: number | null;
  /** Share of the deployment's indexer attempts. Bounded by 1. No probe feed can compute this. */
  served_share: number | null;
  /** User queries on the deployment. attempts ÷ this = the gateway's retry rate, not a share. */
  deployment_user_queries: number | null;
}


// ── Presentation helpers ──────────────────────────────────────────────────────

export function gradeVariant(grade: Grade | string | null | undefined): BadgeVariant {
  switch (grade) {
    case 'A':
      return 'success';
    case 'B':
      return 'accent';
    case 'C':
      return 'warning';
    case 'D':
    case 'F':
      return 'error';
    default:
      return 'default';
  }
}

export function severityVariant(severity: Severity | string | null | undefined): BadgeVariant {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
      return 'default';
    default:
      return 'default';
  }
}

/** CSS-var color for a 0..100 sub-score (green good → red bad). */
export function scoreColor(v: number | null | undefined): string {
  if (v == null) return 'var(--text-faint)';
  if (v >= 75) return 'var(--green)';
  if (v >= 50) return 'var(--amber)';
  return 'var(--red)';
}

/** Human label for a verdict/attention kind. */
export function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    'serving-bad-data': 'Serving bad data',
    'serving-no-data': 'Serving no data',
    'behind-chainhead': 'Behind chainhead',
    'behind-deployment': 'Behind on deployment',
    'behind-deployments': 'Behind on multiple deployments',
    'serving-errors-deployment': 'Serving errors on deployment',
    'serving-errors': 'Serving errors (indexer-wide)',
    'low-coverage': 'Low coverage',
    leech: 'Leech',
    'reo-ineligible-candidate': 'REO-ineligible candidate',
    'dispute-candidate': 'Dispute candidate',
    'sybil-swarm-member': 'Sybil swarm member',
  };
  return map[kind] ?? kind;
}
