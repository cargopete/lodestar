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
    'low-coverage': 'Low coverage',
    leech: 'Leech',
    'reo-ineligible-candidate': 'REO-ineligible candidate',
    'dispute-candidate': 'Dispute candidate',
    'sybil-swarm-member': 'Sybil swarm member',
  };
  return map[kind] ?? kind;
}
