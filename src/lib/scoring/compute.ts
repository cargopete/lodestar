/**
 * Leaderboard score computation (RFC-003).
 *
 * Pulls raw metrics from Postgres, computes percentile-normalised scores
 * for each component, applies penalties, and writes results to indexer_scores.
 *
 * Designed to run nightly via cron.
 */

import type { DbClient } from '../db';
import { computeBounds } from './normalize';
import {
  scoreQueryFees,
  scoreAllocationEfficiency,
  scoreDelegatorApr,
  scoreEffectiveCut,
  scoreDelegationCapacity,
  scoreCutStability,
  scoreTenure,
  scoreRetention,
  scoreReo,
  scorePoiConsensus,
  scoreAllocationBreadth,
} from './components';
import { calculatePenalties, type PenaltyInput } from './penalties';

// Max achievable subtotal without community votes
const MAX_SUBTOTAL_WITHOUT_VOTES = 90;

interface IndexerMetrics {
  address: string;
  // Network Contribution
  queryFees: number;
  allocEfficiency: number;
  // Economics
  delegatorApr: number;
  effectiveCut: number;
  capacityPct: number;
  // Trust & Stability
  cutNetChangePpm: number;
  monthsActive: number;
  netFlow30d: number;
  // Protocol Health
  reoStatus: string;
  poiConsensusRate: number | null;
  distinctDeployments: number;
  // Penalties
  penalties: PenaltyInput;
  // Raw for query
  selfStakeGrt: number;
  hasActiveAllocations: boolean;
  queryFees30d: number;
}

export interface LeaderboardEntry {
  indexer_address: string;
  period_type: string;
  period_start: string;
  period_end: string;
  query_fee_score: number;
  allocation_efficiency_score: number;
  delegator_apr_score: number;
  effective_cut_score: number;
  capacity_score: number;
  cut_stability_score: number;
  tenure_bonus: number;
  retention_score: number;
  reo_score: number;
  poi_consensus_score: number;
  allocation_breadth_score: number;
  community_vote_score: number;
  subtotal: number;
  penalty_multiplier: number;
  final_score: number;
  months_active: number;
  is_eligible_for_badge: boolean;
  rank?: number;
}

export async function computeMonthlyScores(
  sql: DbClient,
  opts: { year: number; month: number }
): Promise<{ scored: number; entries: LeaderboardEntry[] }> {
  const { year, month } = opts;
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const periodEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  console.log(`Computing monthly scores for ${periodStart} to ${periodEnd}`);

  // ── Gather raw metrics from Postgres ──────────────────

  // 1. Active indexers with current state
  const indexers = await sql`
    SELECT address, self_stake_grt, delegated_grt, delegator_apr,
           effective_cut, delegation_capacity_pct, reo_status,
           created_at_ts, allocation_count
    FROM indexers
    WHERE self_stake_grt > 0
  `;

  if (indexers.length === 0) {
    console.log('No indexers found — skipping score computation');
    return { scored: 0, entries: [] };
  }

  // 2. Query fees earned this month (from closed allocations)
  const feeRows = await sql`
    SELECT indexer_address, SUM(query_fees_grt) as fees
    FROM allocations
    WHERE closed_at >= ${periodStart}::date AND closed_at < ${periodEnd}::date
      AND status = 'closed'
    GROUP BY indexer_address
  `;
  const feeMap = new Map(feeRows.map((r) => [r.indexer_address, Number(r.fees)]));

  // 3. Allocation efficiency this month
  const effRows = await sql`
    SELECT indexer_address,
      CASE WHEN SUM(allocated_tokens_grt) > 0
        THEN SUM(query_fees_grt) / SUM(allocated_tokens_grt)
        ELSE 0
      END as efficiency
    FROM allocations
    WHERE closed_at >= ${periodStart}::date AND closed_at < ${periodEnd}::date
      AND status = 'closed'
    GROUP BY indexer_address
  `;
  const effMap = new Map(effRows.map((r) => [r.indexer_address, Number(r.efficiency)]));

  // 4. Reward cut changes (12-month lookback for stability)
  const cutChanges = await sql`
    SELECT indexer_address,
      SUM(CASE WHEN new_value > old_value THEN new_value - old_value ELSE 0 END) as increases,
      SUM(CASE WHEN new_value < old_value THEN old_value - new_value ELSE 0 END) as decreases,
      COUNT(*) FILTER (WHERE new_value > old_value) as increase_count
    FROM parameter_changes
    WHERE param_name = 'reward_cut'
      AND detected_at >= NOW() - INTERVAL '12 months'
    GROUP BY indexer_address
  `;
  const cutMap = new Map(cutChanges.map((r) => [r.indexer_address, {
    netChange: Number(r.increases) - Number(r.decreases),
    increaseCount: Number(r.increase_count),
  }]));

  // 5. Delegation retention (30-day net flow)
  const flowRows = await sql`
    SELECT indexer as indexer_address,
      SUM(CASE
        WHEN event_type = 'delegation' THEN tokens_grt
        WHEN event_type = 'undelegation' THEN -tokens_grt
        ELSE 0
      END) as net_flow
    FROM delegation_events
    WHERE timestamp >= NOW() - INTERVAL '30 days'
    GROUP BY indexer
  `;
  const flowMap = new Map(flowRows.map((r) => [r.indexer_address, Number(r.net_flow)]));

  // 6. POI consensus rate (90-day)
  const poiRows = await sql`
    WITH allocation_pois AS (
      SELECT deployment_id, closed_epoch, poi, indexer_address
      FROM allocations
      WHERE closed_at >= NOW() - INTERVAL '90 days'
        AND poi IS NOT NULL
        AND poi != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND status = 'closed'
    ),
    consensus AS (
      SELECT deployment_id, closed_epoch, poi,
        ROW_NUMBER() OVER (
          PARTITION BY deployment_id, closed_epoch
          ORDER BY COUNT(*) DESC
        ) as rn
      FROM allocation_pois
      GROUP BY deployment_id, closed_epoch, poi
    )
    SELECT a.indexer_address,
      COUNT(*)::numeric as total,
      SUM(CASE WHEN a.poi = c.poi THEN 1 ELSE 0 END)::numeric as matches
    FROM allocation_pois a
    JOIN consensus c ON a.deployment_id = c.deployment_id
      AND a.closed_epoch = c.closed_epoch
      AND c.rn = 1
    GROUP BY a.indexer_address
  `;
  const poiMap = new Map(poiRows.map((r) => [
    r.indexer_address,
    Number(r.total) > 0 ? Number(r.matches) / Number(r.total) : null,
  ]));

  // 7. Allocation breadth (distinct active deployments)
  const breadthRows = await sql`
    SELECT indexer_address, COUNT(DISTINCT deployment_id) as cnt
    FROM allocations
    WHERE status = 'open'
    GROUP BY indexer_address
  `;
  const breadthMap = new Map(breadthRows.map((r) => [r.indexer_address, Number(r.cnt)]));

  // 8. Active disputes
  const disputeRows = await sql`
    SELECT indexer_address, status, closed_at
    FROM disputes
    WHERE status IN ('undecided', 'accepted')
  `;
  const disputeMap = new Map<string, { hasActive: boolean; hasRecent: boolean; hasOlder: boolean }>();
  const now = Date.now();
  const twelveMonthsMs = 365.25 * 24 * 3600 * 1000;
  for (const d of disputeRows) {
    const entry = disputeMap.get(d.indexer_address) ?? { hasActive: false, hasRecent: false, hasOlder: false };
    if (d.status === 'undecided') {
      entry.hasActive = true;
    } else if (d.status === 'accepted') {
      const closedMs = d.closed_at ? new Date(d.closed_at).getTime() : 0;
      if (now - closedMs < twelveMonthsMs) {
        entry.hasRecent = true;
      } else if (now - closedMs < 2 * twelveMonthsMs) {
        entry.hasOlder = true;
      }
    }
    disputeMap.set(d.indexer_address, entry);
  }

  // 9. Query fees in last 30 days (for zero-fees penalty — rolling, not period-specific)
  const fees30dRows = await sql`
    SELECT indexer_address, SUM(query_fees_grt) as fees
    FROM allocations
    WHERE closed_at >= NOW() - INTERVAL '30 days'
      AND status = 'closed'
    GROUP BY indexer_address
  `;
  const fees30dMap = new Map(fees30dRows.map((r) => [r.indexer_address, Number(r.fees)]));

  // 10. POI consensus last 30 days (for penalty check)
  const poi30dRows = await sql`
    WITH recent_pois AS (
      SELECT deployment_id, closed_epoch, poi, indexer_address
      FROM allocations
      WHERE closed_at >= NOW() - INTERVAL '30 days'
        AND poi IS NOT NULL
        AND poi != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND status = 'closed'
    ),
    consensus AS (
      SELECT deployment_id, closed_epoch, poi,
        ROW_NUMBER() OVER (
          PARTITION BY deployment_id, closed_epoch
          ORDER BY COUNT(*) DESC
        ) as rn
      FROM recent_pois
      GROUP BY deployment_id, closed_epoch, poi
    )
    SELECT a.indexer_address,
      COUNT(*) as total,
      CASE WHEN COUNT(*) > 0
        THEN SUM(CASE WHEN a.poi = c.poi THEN 1 ELSE 0 END)::numeric / COUNT(*)
        ELSE NULL
      END as rate
    FROM recent_pois a
    JOIN consensus c ON a.deployment_id = c.deployment_id
      AND a.closed_epoch = c.closed_epoch
      AND c.rn = 1
    GROUP BY a.indexer_address
  `;
  const poi30dMap = new Map(poi30dRows.map((r) => [r.indexer_address, {
    rate: r.rate !== null ? Number(r.rate) : null,
    total: Number(r.total),
  }]));

  // ── Assemble metrics per indexer ──────────────────────

  const metrics: IndexerMetrics[] = indexers.map((idx) => {
    const addr = idx.address;
    const cutData = cutMap.get(addr) ?? { netChange: 0, increaseCount: 0 };
    const disputes = disputeMap.get(addr) ?? { hasActive: false, hasRecent: false, hasOlder: false };
    const selfStake = Number(idx.self_stake_grt) || 0;
    const hasActiveAllocs = (Number(idx.allocation_count) || 0) > 0;
    const fees30d = fees30dMap.get(addr) ?? 0;
    const poi30d = poi30dMap.get(addr);
    const poi30dRate = poi30d?.rate ?? null;
    const poi30dTotal = poi30d?.total ?? 0;

    const monthsActive = idx.created_at_ts
      ? Math.floor((now - new Date(idx.created_at_ts).getTime()) / (30 * 24 * 3600 * 1000))
      : 0;

    return {
      address: addr,
      queryFees: feeMap.get(addr) ?? 0,
      allocEfficiency: effMap.get(addr) ?? 0,
      delegatorApr: Number(idx.delegator_apr) || 0,
      effectiveCut: Number(idx.effective_cut) || 0,
      capacityPct: Number(idx.delegation_capacity_pct) || 0,
      cutNetChangePpm: cutData.netChange,
      monthsActive,
      netFlow30d: flowMap.get(addr) ?? 0,
      reoStatus: idx.reo_status ?? 'unknown',
      poiConsensusRate: poiMap.get(addr) ?? null,
      distinctDeployments: breadthMap.get(addr) ?? 0,
      penalties: {
        hasActiveDispute: disputes.hasActive,
        hasRecentSlashing: disputes.hasRecent,
        hasOlderSlashing: disputes.hasOlder,
        hasRepeatedCutIncreases: cutData.increaseCount >= 3,
        hasLowPoiConsensus: poi30dRate != null && poi30dTotal >= 5 && poi30dRate < 0.50,
        hasZeroFees: hasActiveAllocs && fees30d === 0,
        hasBelowMinStake: selfStake < 100000,
      },
      selfStakeGrt: selfStake,
      hasActiveAllocations: hasActiveAllocs,
      queryFees30d: fees30d,
    };
  });

  // ── Compute percentile bounds ─────────────────────────

  const feeBounds = computeBounds(metrics.map((m) => m.queryFees));
  const effBounds = computeBounds(metrics.filter((m) => m.allocEfficiency > 0).map((m) => m.allocEfficiency));
  const aprBounds = computeBounds(metrics.filter((m) => m.delegatorApr > 0).map((m) => m.delegatorApr));
  const cutBounds = computeBounds(metrics.filter((m) => m.effectiveCut > 0).map((m) => m.effectiveCut));

  // ── Score each indexer ────────────────────────────────

  const scored = metrics.map((m) => {
    const queryFeeScore = scoreQueryFees(m.queryFees, feeBounds.p10, feeBounds.p90);
    const allocEffScore = scoreAllocationEfficiency(m.allocEfficiency, effBounds.p10, effBounds.p90);
    const aprScore = scoreDelegatorApr(m.delegatorApr, aprBounds.p10, aprBounds.p90);
    const cutScore = scoreEffectiveCut(m.effectiveCut, cutBounds.p10, cutBounds.p90);
    const capScore = scoreDelegationCapacity(m.capacityPct);
    const stabilityScore = scoreCutStability(m.cutNetChangePpm);
    const tenureScore = scoreTenure(m.monthsActive);
    const retScore = scoreRetention(m.netFlow30d);
    const reoScore = scoreReo(m.reoStatus);
    const poiScore = scorePoiConsensus(m.poiConsensusRate);
    const breadthScore = scoreAllocationBreadth(m.distinctDeployments);

    const subtotal =
      queryFeeScore + allocEffScore +
      aprScore + cutScore + capScore +
      stabilityScore + tenureScore + retScore +
      reoScore + poiScore + breadthScore;

    const { multiplier: penaltyMultiplier } = calculatePenalties(m.penalties);

    // Normalise to 0–100 (max achievable without votes is 90)
    const penalised = subtotal * penaltyMultiplier;
    const finalScore = (penalised / MAX_SUBTOTAL_WITHOUT_VOTES) * 100;

    return {
      indexer_address: m.address,
      period_type: 'monthly',
      period_start: periodStart,
      period_end: periodEnd,
      query_fee_score: round2(queryFeeScore),
      allocation_efficiency_score: round2(allocEffScore),
      delegator_apr_score: round2(aprScore),
      effective_cut_score: round2(cutScore),
      capacity_score: round2(capScore),
      cut_stability_score: round2(stabilityScore),
      tenure_bonus: round2(tenureScore),
      retention_score: round2(retScore),
      reo_score: round2(reoScore),
      poi_consensus_score: round2(poiScore),
      allocation_breadth_score: round2(breadthScore),
      community_vote_score: 0,
      subtotal: round2(subtotal),
      penalty_multiplier: round2(penaltyMultiplier),
      final_score: round2(Math.min(100, Math.max(0, finalScore))),
      months_active: m.monthsActive,
      is_eligible_for_badge: false, // set after ranking — #1 gets the badge
    };
  });

  // Assign ranks by final_score descending
  scored.sort((a, b) => b.final_score - a.final_score);
  scored.forEach((s, i) => {
    (s as Record<string, unknown>).rank = i + 1;
  });

  // #1 is Indexer of the Month
  if (scored.length > 0) {
    scored[0].is_eligible_for_badge = true;
  }

  // ── Write to Postgres ─────────────────────────────────

  // Delete existing scores for this period (idempotent re-run)
  await sql`
    DELETE FROM indexer_scores
    WHERE period_type = 'monthly' AND period_start = ${periodStart}::date
  `;

  // Insert in chunks
  const CHUNK = 200;
  for (let i = 0; i < scored.length; i += CHUNK) {
    const batch = scored.slice(i, i + CHUNK);
    await sql`INSERT INTO indexer_scores ${sql(batch)}`;
  }

  console.log(`Scored ${scored.length} indexers for ${periodStart}. Top: ${scored[0]?.indexer_address} (${scored[0]?.final_score})`);

  return { scored: scored.length, entries: scored as LeaderboardEntry[] };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
