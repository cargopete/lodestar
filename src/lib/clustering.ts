/**
 * Behaviorally-correlated cluster detection (pure, testable).
 *
 * LIABILITY DISCIPLINE (non-negotiable — see plans/qos-scoring-and-network-health.md):
 *  - NEVER label a cluster "sybil" or "fraud". These are "behaviorally correlated clusters".
 *  - Output is PROBABILISTIC, evidence-bearing, confidence-tiered — never a binary verdict.
 *  - Clustering is a working hypothesis for human review, NEVER an automated punitive action.
 *  - Correlation ≠ common control; shared infra (SaaS) produces correlated signatures legitimately.
 *
 * Signals used here (all from existing Postgres data — no funding graph yet):
 *  - Allocation-set Jaccard overlap (do they allocate to the same deployments?)
 *  - Registration cohort (same created-at epoch)
 *  - Parameter mirroring (identical reward + query-fee cuts)
 *
 * An edge requires HIGH allocation overlap AND a corroborating signal (cohort or mirrored cuts),
 * because allocation overlap alone is explained by the shared allocation-optimizer, and a shared
 * registration epoch alone is explained by network events. "Combination, not any single signal."
 *
 * TIER CEILING: without a funding-source link (Amp funding graph — Q8b), the maximum confidence is
 * Tier 2 ("behaviorally correlated"). Tier 3 ("high-confidence, shared funding") is intentionally
 * unreachable until the funding graph lands.
 */

export interface ClusterInput {
  address: string;
  deployments: string[]; // active allocation deployment set
  createdAtEpoch: number | null;
  rewardCut: number | null;
  queryFeeCut: number | null;
  allocationCount: number;
}

export interface ClusterEdge {
  a: string;
  b: string;
  jaccard: number;
  sameEpoch: boolean;
  sameCuts: boolean;
}

export interface Cluster {
  id: string;
  members: string[];
  tier: 2; // behavioral only; Tier 3 needs funding graph (not built)
  size: number;
  avgJaccard: number;
  sharedEpoch: number | null; // set if all members share a registration epoch
  signals: string[]; // human-readable evidence summary
}

export interface ClusterOpts {
  jaccardHi?: number; // overlap threshold to count as a strong signal
  minAllocations?: number; // ignore tiny operators (noise floor, à la Rated's >5-unit idea)
  allowlist?: Set<string>; // known SaaS/infra providers — excluded from clustering
}

const DEFAULTS = { jaccardHi: 0.6, minAllocations: 3 };

/** Known SaaS / infrastructure providers whose shared signatures are legitimate.
 *  Seed with verified addresses before relying on this in production. */
export const SAAS_ALLOWLIST = new Set<string>([
  // e.g. Pinax, StakeSquid-managed, GraphOps Launchpad operators — add verified addresses here.
]);

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function detectClusters(indexers: ClusterInput[], opts: ClusterOpts = {}): Cluster[] {
  const jaccardHi = opts.jaccardHi ?? DEFAULTS.jaccardHi;
  const minAllocations = opts.minAllocations ?? DEFAULTS.minAllocations;
  const allowlist = opts.allowlist ?? SAAS_ALLOWLIST;

  // Eligible nodes: enough allocations to be meaningful, not an allowlisted provider.
  const nodes = indexers
    .filter((i) => i.allocationCount >= minAllocations && i.deployments.length > 0)
    .filter((i) => !allowlist.has(i.address.toLowerCase()))
    .map((i) => ({ ...i, address: i.address.toLowerCase(), set: new Set(i.deployments) }));

  // Pairwise edges (require high overlap AND a corroborating signal).
  const edges: ClusterEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const A = nodes[i];
      const B = nodes[j];
      const jac = jaccard(A.set, B.set);
      if (jac < jaccardHi) continue;
      const sameEpoch =
        A.createdAtEpoch != null && A.createdAtEpoch === B.createdAtEpoch;
      const sameCuts =
        A.rewardCut != null &&
        A.rewardCut === B.rewardCut &&
        A.queryFeeCut != null &&
        A.queryFeeCut === B.queryFeeCut;
      // Edge only if a corroborating signal accompanies the high overlap.
      if (sameEpoch || sameCuts) {
        edges.push({ a: A.address, b: B.address, jaccard: jac, sameEpoch, sameCuts });
      }
    }
  }

  // Connected components (union-find).
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    parent.set(x, parent.get(x) ?? x);
    let root = parent.get(x)!;
    while (root !== parent.get(root)) {
      root = parent.get(root)!;
    }
    parent.set(x, root);
    return root;
  };
  const union = (x: string, y: string) => {
    parent.set(find(x), find(y));
  };
  for (const e of edges) {
    find(e.a);
    find(e.b);
    union(e.a, e.b);
  }

  // Group members + summarise evidence per component.
  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    if (!parent.has(node.address)) continue; // not in any edge
    const root = find(node.address);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(node.address);
  }

  const byNode = new Map(nodes.map((n) => [n.address, n]));
  const clusters: Cluster[] = [];
  let idx = 0;
  for (const [, members] of groups) {
    if (members.length < 2) continue;
    const memberEdges = edges.filter((e) => members.includes(e.a) && members.includes(e.b));
    const avgJaccard = memberEdges.length
      ? memberEdges.reduce((s, e) => s + e.jaccard, 0) / memberEdges.length
      : 0;
    const epochs = new Set(members.map((m) => byNode.get(m)?.createdAtEpoch));
    const sharedEpoch = epochs.size === 1 ? [...epochs][0] ?? null : null;

    const signals: string[] = [`High allocation overlap (avg Jaccard ${(avgJaccard * 100).toFixed(0)}%)`];
    if (sharedEpoch != null) signals.push(`Shared registration epoch (${sharedEpoch})`);
    if (memberEdges.some((e) => e.sameCuts)) signals.push('Identical cut parameters');

    clusters.push({
      id: `cluster-${idx++}`,
      members: members.sort(),
      tier: 2,
      size: members.length,
      avgJaccard,
      sharedEpoch,
      signals,
    });
  }

  return clusters.sort((a, b) => b.size - a.size);
}
