'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type RowSelectionState,
  type FilterFn,
} from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useEnrichedIndexers, useIndexers, useNetworkStats } from '@/hooks/useNetworkStats';
import { qosGrade } from '@/lib/qos-score';
import {
  weiToGRT,
  formatGRT,
  formatPPM,
  shortenAddress,
  resolveIndexerName,
  calculateCapacityUsed,
  isGreedyCut,
  cn,
} from '@/lib/utils';
import type { Indexer } from '@/lib/queries';
import type { EnrichedIndexer } from '@/lib/enriched';
import { cooldownRemainingDays } from '@/lib/network-math';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Badge } from '@/components/ui/Badge';
import { IndexerComparison } from '@/components/ui/IndexerComparison';

// Minimum self-stake for REO eligibility heuristic fallback (100K GRT)
const MIN_STAKE_REO = 100000;

/**
 * Quick client-side REO eligibility heuristic — used only when enriched
 * (oracle-sourced) data isn't available yet. Not authoritative.
 */
function quickREOStatus(indexer: Indexer): 'eligible' | 'ineligible' | 'unknown' {
  const selfStake = weiToGRT(indexer.stakedTokens) - weiToGRT(indexer.lockedTokens ?? '0');
  const hasAllocations = indexer.allocationCount > 0;
  const hasSufficientStake = selfStake >= MIN_STAKE_REO;
  return (hasAllocations && hasSufficientStake) ? 'eligible' : 'ineligible';
}

interface IndexerRow {
  id: string;
  name: string;
  address: string;
  url: string | null;
  selfStake: number;
  delegated: number;
  capacity: number;
  rewardCut: number;
  queryCut: number;
  cooldownRemaining: number; // days until delegation params can change (0 = none)
  allocations: number;
  allocated: number;
  rewards: number;
  feesCollected: number;
  reoStatus: 'eligible' | 'ineligible' | 'unknown';
  reoSource: 'oracle' | 'heuristic' | null;
  reoDaysRemaining: number | null;
  recentDelegations: { delegations: number; undelegations: number; netFlowGRT: number } | null;
  apr: number | null;
  effectiveCut: number | null;
  overDelegationDilution: number | null;
  rollingAPY30d: number | null;
  rollingAPY90d: number | null;
  score: number | null;
  scoreGrade: 'A' | 'B' | 'C' | 'D' | 'F' | null;
  qScore: number | null;
  raw: Indexer;
}

// Search across name, address, and URL (many indexers have no display name set)
const nameAddressFilter: FilterFn<IndexerRow> = (row, _columnId, filterValue) => {
  const search = (filterValue as string).toLowerCase();
  return (
    row.original.name.toLowerCase().includes(search) ||
    row.original.address.toLowerCase().includes(search) ||
    (row.original.url?.toLowerCase().includes(search) ?? false)
  );
};

const columnHelper = createColumnHelper<IndexerRow>();

// Module-level cache so repeated renders / page navigations don't re-fetch
const syncHealthCache = new Map<string, { reachable: boolean; totalDeployments: number; syncedCount: number; worstBlocksBehind?: number }>();

// Dropped chains — fetched once for all indexers via a shared promise
let droppedChainsPromise: Promise<Record<string, string[]>> | null = null;
function getDroppedChains(): Promise<Record<string, string[]>> {
  if (!droppedChainsPromise) {
    droppedChainsPromise = fetch('/api/dropped-chains')
      .then((r) => r.json())
      .then(({ data }) => (data ?? {}) as Record<string, string[]>)
      .catch(() => ({} as Record<string, string[]>));
  }
  return droppedChainsPromise;
}

/**
 * Sync health warning badge — only renders when there's a meaningful issue.
 * Healthy nodes (≥85% synced) show nothing to keep the UI clean.
 * Nodes with <3 deployments or unreachable nodes are silently skipped.
 */
function SyncDot({ address, url }: { address: string; url: string | null }) {
  const [health, setHealth] = useState(syncHealthCache.get(address) ?? null);
  const fetching = useRef(false);

  useEffect(() => {
    if (!url || health !== null || fetching.current) return;
    fetching.current = true;
    fetch(`/api/indexer-node-health?url=${encodeURIComponent(url)}&addr=${encodeURIComponent(address)}`)
      .then((r) => r.json())
      .then(({ data }) => {
        if (data) {
          syncHealthCache.set(address, data);
          setHealth(data);
        }
      })
      .catch(() => {/* silent */})
      .finally(() => { fetching.current = false; });
  }, [address, url, health]);

  if (!url || health === null) return null;
  if (!health.reachable || health.totalDeployments < 3) return null;

  const syncedPct = Math.round((health.syncedCount / health.totalDeployments) * 100);
  if (syncedPct >= 85) return null;

  const isCritical = syncedPct < 50;
  const color = isCritical ? 'var(--red)' : 'var(--amber)';
  const behind = health.worstBlocksBehind;
  const lagText = behind ? `, up to ${behind.toLocaleString()} blocks behind` : '';
  const tipBody = `${syncedPct}% of deployments at chain head${lagText}. View the indexer profile for per-subgraph detail.`;

  return (
    <span className="relative group/sync inline-flex items-center">
      <span
        className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-semibold leading-none"
        style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
      >
        <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L1 21h22L12 2zm0 3.5L20.5 19H3.5L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z" />
        </svg>
        {syncedPct}%
      </span>
      <span className="absolute left-0 top-full mt-1.5 w-56 p-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl opacity-0 pointer-events-none group-hover/sync:opacity-100 transition-opacity z-50 text-[11px] whitespace-normal">
        <span className="block font-semibold text-[var(--text)] mb-1">Sync Warning</span>
        <span className="block text-[var(--text-muted)] leading-relaxed">{tipBody}</span>
      </span>
    </span>
  );
}

/**
 * Dropped chain warning — shows when the cron detects a chain was present in the
 * previous snapshot but absent in the most recent one. Silent delegation risk signal.
 */
function DroppedChainDot({ address }: { address: string }) {
  const [dropped, setDropped] = useState<string[]>([]);

  useEffect(() => {
    getDroppedChains().then((map) => {
      setDropped(map[address.toLowerCase()] ?? []);
    });
  }, [address]);

  if (!dropped.length) return null;

  const label = dropped.length <= 2 ? dropped.join(', ') : `${dropped.slice(0, 2).join(', ')} +${dropped.length - 2}`;
  const tipBody = `This indexer appears to have stopped serving: ${dropped.join(', ')}. Chains missing from their node since the last snapshot — may indicate infra changes. Check before delegating.`;

  return (
    <span className="relative group/drop inline-flex items-center">
      <span
        className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-semibold leading-none"
        style={{ color: 'var(--amber)', backgroundColor: 'color-mix(in srgb, var(--amber) 12%, transparent)' }}
      >
        <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 17h8m0 0-3-3m3 3-3 3M6 10v-1a6 6 0 0112 0" />
        </svg>
        {label}
      </span>
      <span className="absolute left-0 top-full mt-1.5 w-60 p-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl opacity-0 pointer-events-none group-hover/drop:opacity-100 transition-opacity z-50 text-[11px] whitespace-normal">
        <span className="block font-semibold text-[var(--text)] mb-1">Chain Drop Detected</span>
        <span className="block text-[var(--text-muted)] leading-relaxed">{tipBody}</span>
      </span>
    </span>
  );
}

/** Column header with an info tooltip on hover */
function HeaderTip({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="relative group/tip inline-flex items-center gap-1">
      {label}
      <svg className="w-3 h-3 text-[var(--text-faint)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" d="M12 16v-4m0-4h.01" />
      </svg>
      <span className="absolute left-0 top-full mt-1.5 w-56 p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl opacity-0 pointer-events-none group-hover/tip:opacity-100 transition-opacity z-50 text-[11px] font-normal normal-case tracking-normal text-[var(--text)]">
        {tip}
      </span>
    </span>
  );
}

export function IndexerTable() {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'score', desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [minStake, setMinStake] = useState(100000);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [showComparison, setShowComparison] = useState(false);

  // Try enriched data first (pre-computed by cron), fall back to raw indexers
  const { data: enrichedData, isLoading: enrichedLoading } = useEnrichedIndexers();
  const { data: indexersData, isLoading: indexersLoading } = useIndexers({
    first: 500,
    orderBy: 'stakedTokens',
    orderDirection: 'desc',
  });

  const { data: networkData } = useNetworkStats();
  const delegationRatio = networkData?.graphNetwork?.delegationRatio ?? 16;

  // QoS quality scores (address → Q-score), from the network-health leaderboard.
  const { data: qosResp } = useQuery<Record<string, number>>({
    queryKey: ['qosScoreMap'],
    queryFn: async () => {
      const r = await fetch('/api/network-health');
      if (!r.ok) return {};
      const j = await r.json();
      const m: Record<string, number> = {};
      for (const it of j?.data?.indexers ?? []) {
        if (it.q_score != null && it.address) m[String(it.address).toLowerCase()] = it.q_score;
      }
      return m;
    },
    staleTime: 30 * 60 * 1000,
  });

  const hasEnriched = !!enrichedData?.indexers?.length;
  const isLoading = hasEnriched ? false : (enrichedLoading || indexersLoading);

  const tableData: IndexerRow[] = useMemo(() => {
    // Prefer enriched data from cron (includes APR, effective cut, activity — zero N+1 queries)
    if (hasEnriched) {
      return enrichedData!.indexers
        .map((e: EnrichedIndexer): IndexerRow => ({
          id: e.id,
          name: e.name,
          address: e.id,
          url: e.url,
          selfStake: e.selfStakeGRT,
          delegated: e.delegatedGRT,
          capacity: e.delegationCapacity.utilizationPercent,
          rewardCut: e.indexingRewardCut,
          queryCut: e.queryFeeCut,
          cooldownRemaining: cooldownRemainingDays(
            e.delegatorParameterCooldown ?? 0,
            e.lastDelegationParameterUpdate ?? 0,
            Math.floor(Date.now() / 1000),
          ),
          allocations: e.allocationCount,
          allocated: weiToGRT(e.allocatedTokens),
          rewards: weiToGRT(e.rewardsEarned),
          feesCollected: e.queryFeesCollectedGRT ?? 0,
          reoStatus: e.reoStatus,
          reoSource: e.reoSource ?? null,
          reoDaysRemaining: e.reoDaysRemaining ?? null,
          recentDelegations: (e.recentActivity.delegationsIn7d > 0 || e.recentActivity.undelegationsIn7d > 0)
            ? { delegations: e.recentActivity.delegationsIn7d, undelegations: e.recentActivity.undelegationsIn7d, netFlowGRT: e.recentActivity.netFlowGRT }
            : null,
          apr: e.delegatorAPR,
          effectiveCut: e.effectiveCut,
          overDelegationDilution: e.overDelegationDilution,
          rollingAPY30d: e.rollingAPY30d ?? null,
          rollingAPY90d: e.rollingAPY90d ?? null,
          score: e.score ?? null,
          scoreGrade: e.scoreGrade ?? null,
          qScore: (qosResp ?? {})[e.id.toLowerCase()] ?? null,
          // Reconstruct raw Indexer shape for comparison panel
          raw: {
            id: e.id,
            account: { id: e.id, defaultDisplayName: e.name, metadata: null },
            stakedTokens: e.stakedTokens,
            delegatedTokens: e.delegatedTokens,
            allocatedTokens: e.allocatedTokens,
            allocationCount: e.allocationCount,
            indexingRewardCut: e.indexingRewardCut,
            queryFeeCut: e.queryFeeCut,
            delegatorParameterCooldown: e.delegatorParameterCooldown,
            lastDelegationParameterUpdate: e.lastDelegationParameterUpdate,
            rewardsEarned: e.rewardsEarned,
            delegatorShares: e.delegatorShares,
            url: e.url,
            geoHash: e.geoHash,
            createdAt: e.createdAt,
          },
        }))
        .filter((row) => row.selfStake >= minStake);
    }

    // Fallback: raw indexer data (no APR, no effective cut, no activity)
    if (!indexersData?.indexers) return [];

    return indexersData.indexers
      .map((indexer: Indexer) => {
        const selfStake = weiToGRT(indexer.stakedTokens) - weiToGRT(indexer.lockedTokens ?? '0');
        const delegated = weiToGRT(indexer.delegatedTokens);
        const allocated = weiToGRT(indexer.allocatedTokens);
        const rewards = weiToGRT(indexer.rewardsEarned);

        return {
          id: indexer.id,
          name: resolveIndexerName(indexer.account, indexer.id),
          address: indexer.id,
          url: indexer.url,
          selfStake,
          delegated,
          capacity: calculateCapacityUsed(selfStake, delegated, delegationRatio),
          rewardCut: indexer.indexingRewardCut,
          queryCut: indexer.queryFeeCut,
          cooldownRemaining: cooldownRemainingDays(
            indexer.delegatorParameterCooldown ?? 0,
            indexer.lastDelegationParameterUpdate ?? 0,
            Math.floor(Date.now() / 1000),
          ),
          allocations: indexer.allocationCount,
          allocated,
          rewards,
          feesCollected: 0,
          reoStatus: quickREOStatus(indexer),
          reoSource: null,
          reoDaysRemaining: null,
          recentDelegations: null,
          apr: null,
          effectiveCut: null,
          overDelegationDilution: null,
          rollingAPY30d: null,
          rollingAPY90d: null,
          score: null,
          scoreGrade: null,
          qScore: (qosResp ?? {})[indexer.id.toLowerCase()] ?? null,
          raw: indexer,
        };
      })
      .filter((row) => row.selfStake >= minStake);
  }, [enrichedData, hasEnriched, indexersData, delegationRatio, minStake, qosResp]);

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
            className="rounded border-[var(--border)] bg-[var(--bg-elevated)]"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
            className="rounded border-[var(--border)] bg-[var(--bg-elevated)]"
          />
        ),
      }),
      columnHelper.accessor('name', {
        header: 'Indexer',
        cell: (info) => {
          const row = info.row.original;
          return (
            <div>
              <p className="font-medium text-[var(--text)] hover:text-[var(--accent)] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap">
                <Link href={`/indexers/${row.address}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                  {info.getValue()}
                </Link>
                {/* REO eligibility indicator */}
                <span className="relative group/reo inline-flex">
                  <span className={cn(
                    'w-2 h-2 rounded-full inline-block',
                    row.reoStatus === 'eligible' ? 'bg-[var(--green)]' : 'bg-[var(--red)]'
                  )} />
                  <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-52 p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl opacity-0 pointer-events-none group-hover/reo:opacity-100 transition-opacity z-50 text-[11px] font-normal">
                    <span className="block font-semibold text-[var(--text)] mb-1">Rewards Eligibility (GIP-0079)</span>
                    <span className={cn(
                      'block font-medium',
                      row.reoStatus === 'eligible' ? 'text-[var(--green)]' : 'text-[var(--red)]'
                    )}>
                      {row.reoStatus === 'eligible' ? 'Eligible' : 'Ineligible'}
                    </span>
                    {row.reoSource === 'oracle' && row.reoDaysRemaining !== null && (
                      <span className="block text-[var(--text-faint)] mt-1">
                        {row.reoDaysRemaining > 0
                          ? `Renews in ${row.reoDaysRemaining.toFixed(1)}d`
                          : 'Renewal overdue'}
                      </span>
                    )}
                    {row.reoSource !== 'oracle' && (
                      <span className="block text-[var(--text-faint)] mt-1">Estimate — oracle data pending</span>
                    )}
                  </span>
                </span>
                {/* Node sync health indicator */}
                <SyncDot address={row.address} url={row.url} />
                {/* Dropped chain signal */}
                <DroppedChainDot address={row.address} />
                {/* Recent delegation activity indicator */}
                {row.recentDelegations && (
                  <span className="relative group/del inline-flex">
                    <svg className="w-3 h-3 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
                    </svg>
                    <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-48 p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl opacity-0 pointer-events-none group-hover/del:opacity-100 transition-opacity z-50 text-[11px] font-normal">
                      <span className="block font-semibold text-[var(--text)] mb-1">Delegation Activity (7d)</span>
                      {row.recentDelegations.delegations > 0 && (
                        <span className="block text-[var(--green)]">
                          {row.recentDelegations.delegations} delegation{row.recentDelegations.delegations !== 1 ? 's' : ''}
                        </span>
                      )}
                      {row.recentDelegations.undelegations > 0 && (
                        <span className="block text-[var(--red)]">
                          {row.recentDelegations.undelegations} undelegation{row.recentDelegations.undelegations !== 1 ? 's' : ''}
                        </span>
                      )}
                      <span className={`block font-mono mt-0.5 ${row.recentDelegations.netFlowGRT >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                        {row.recentDelegations.netFlowGRT >= 0 ? '+' : ''}{formatGRT(row.recentDelegations.netFlowGRT)} GRT
                      </span>
                    </span>
                  </span>
                )}
              </p>
              <p className="text-xs text-[var(--text-faint)] font-mono">
                {shortenAddress(row.address)}
              </p>
            </div>
          );
        },
      }),
      columnHelper.accessor('score', {
        header: () => <HeaderTip label="Score" tip="Composite grade (A-F) across 7 dimensions: REO compliance, self-stake, cut stability, allocation efficiency, over-delegation, transparency, and delegation trend." />,
        cell: (info) => {
          const row = info.row.original;
          const score = info.getValue();
          if (score === null) return <span className="text-[var(--text-faint)]">—</span>;
          const color = score >= 80 ? 'var(--green)' : score >= 65 ? 'var(--teal, var(--green))' : score >= 50 ? 'var(--amber)' : 'var(--red)';
          return (
            <span className="font-mono font-semibold" style={{ color }}>
              {score}
              {row.scoreGrade && (
                <span className="ml-1 text-[11px] font-medium opacity-70">{row.scoreGrade}</span>
              )}
            </span>
          );
        },
        sortUndefined: 'last',
      }),
      columnHelper.accessor('qScore', {
        header: () => <HeaderTip label="QoS" tip="Selection-bias-aware service-quality score (0–100): Wilson-reliability × latency × freshness, normalised per-deployment. Measures actual served quality, not raw volume. See Indexer QoS." />,
        cell: (info) => {
          const q = info.getValue();
          if (q === null) return <span className="text-[var(--text-faint)]">—</span>;
          const g = qosGrade(q);
          const color = q >= 75 ? 'var(--green)' : q >= 45 ? 'var(--amber)' : 'var(--red)';
          return (
            <span className="font-mono font-semibold" style={{ color }}>
              {q.toFixed(0)}
              <span className="ml-1 text-[11px] font-medium opacity-70">{g.grade}</span>
            </span>
          );
        },
        sortUndefined: 'last',
      }),
      columnHelper.accessor('selfStake', {
        header: () => <HeaderTip label="Self-Stake" tip="GRT the indexer has staked from their own wallet. Higher self-stake means more skin in the game and greater slashing risk if they misbehave." />,
        cell: (info) => (
          <span className="font-mono text-[var(--text)]">
            {formatGRT(info.getValue())} GRT
          </span>
        ),
      }),
      columnHelper.accessor('delegated', {
        header: () => <HeaderTip label="Delegated" tip="Active GRT delegated to this indexer — tokens currently in the 28-day thaw period are excluded, since they earn no rewards and would inflate the denominator." />,
        cell: (info) => (
          <span className="font-mono text-[var(--green)]">
            {formatGRT(info.getValue())} GRT
          </span>
        ),
      }),
      columnHelper.accessor('capacity', {
        header: () => <HeaderTip label="Capacity" tip="How full the indexer's delegation pool is. Over 100% means overdelegated — your rewards get diluted proportionally." />,
        cell: (info) => {
          const value = info.getValue();
          return (
            <div className="w-24">
              <ProgressBar
                value={value}
                max={100}
                size="sm"
                variant={value > 90 ? 'orange' : 'teal'}
              />
              <span className="text-xs font-mono text-[var(--text-muted)] mt-1 block">
                {value.toFixed(1)}% used
              </span>
            </div>
          );
        },
      }),
      columnHelper.accessor('rewardCut', {
        header: () => <HeaderTip label="Reward Cut" tip="The % of indexing rewards the indexer keeps. 'Effective cut' below factors in overdelegation dilution — what you actually lose. A 100% cut means delegators earn nothing." />,
        cell: (info) => {
          const row = info.row.original;
          const lastUpdate = row.raw.lastDelegationParameterUpdate;
          const daysSince = (Date.now() / 1000 - lastUpdate) / 86400;
          const recentChange = daysSince <= 30;
          const greedy = isGreedyCut(info.getValue());
          return (
            <div className={greedy ? 'relative group/greedy' : undefined}>
              <span className={cn(
                'font-mono flex items-center gap-1.5',
                greedy ? 'text-[var(--red)] font-semibold' : 'text-[var(--text)]'
              )}>
                {formatPPM(info.getValue())}
                {recentChange && (
                  <span
                    className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', daysSince <= 7 ? 'bg-[var(--red)]' : 'bg-[var(--amber)]')}
                    title={`Parameters changed ${Math.floor(daysSince)}d ago`}
                  />
                )}
              </span>
              {greedy && (
                <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-56 p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl opacity-0 pointer-events-none group-hover/greedy:opacity-100 transition-opacity z-50 text-[11px] font-normal text-[var(--text)]">
                  100% Reward Cut — delegators earn nothing from this indexer
                </span>
              )}
              {row.effectiveCut !== null && (
                <span className="text-[10px] text-[var(--text-faint)] block">
                  eff. {row.effectiveCut.toFixed(1)}%
                  {row.overDelegationDilution !== null && row.overDelegationDilution > 0 && (
                    <span className="text-[var(--amber)]" title={`${row.overDelegationDilution.toFixed(1)}% overdelegation dilution`}> OD</span>
                  )}
                </span>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor('cooldownRemaining', {
        header: () => <HeaderTip label="Cooldown" tip="Days until this indexer can next change its delegation parameters (cut, etc.). A longer cooldown means more predictable terms for delegators. '—' means no cooldown is currently active." />,
        cell: (info) => {
          const days = info.getValue();
          if (!days || days <= 0) return <span className="text-[var(--text-faint)]">—</span>;
          return <span className="font-mono text-[var(--text)]">{Math.ceil(days)}d</span>;
        },
        sortUndefined: 'last',
      }),
      columnHelper.accessor('apr', {
        header: () => <HeaderTip label="APR" tip="Forward-looking annualised return based on live allocations. Calculated against active delegation only — thawing tokens are excluded so they don't depress the figure. Snapshot, not a guarantee." />,
        cell: (info) => {
          const value = info.getValue();
          if (value === null) return <span className="text-[var(--text-faint)]">—</span>;
          return (
            <span className={cn(
              'font-mono',
              value > 5 ? 'text-[var(--green)]' : 'text-[var(--text)]'
            )}>
              {value.toFixed(2)}%
            </span>
          );
        },
      }),
      columnHelper.accessor('rollingAPY90d', {
        header: () => <HeaderTip label="APY 90d" tip="Compounded return over the last 90 days from delegation pool share growth. Per-share rate — immune to thawing distortion. Hover a value to see 30d APY." />,
        cell: (info) => {
          const value = info.getValue();
          const row = info.row.original;
          if (value === null) return <span className="text-[var(--text-faint)]">—</span>;
          return (
            <span className="relative group/apy">
              <span className={cn(
                'font-mono',
                value > 5 ? 'text-[var(--green)]' : 'text-[var(--text)]'
              )}>
                {value.toFixed(2)}%
              </span>
              <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-44 p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl opacity-0 pointer-events-none group-hover/apy:opacity-100 transition-opacity z-50 text-[11px] font-normal">
                <span className="block text-[var(--text-muted)]">30d APY: {row.rollingAPY30d !== null ? `${row.rollingAPY30d.toFixed(2)}%` : '—'}</span>
                <span className="block text-[var(--text-faint)] mt-0.5">Instant APR: {row.apr !== null ? `${row.apr.toFixed(2)}%` : '—'}</span>
              </span>
            </span>
          );
        },
        sortUndefined: 'last',
      }),
      columnHelper.accessor('feesCollected', {
        header: () => <HeaderTip label="Fees" tip="Total query fees collected. Higher fees suggest the indexer is actively serving real traffic from dApps." />,
        cell: (info) => {
          const value = info.getValue();
          if (!value) return <span className="text-[var(--text-faint)]">—</span>;
          return (
            <span className="font-mono text-[var(--text)]">
              {formatGRT(value)} GRT
            </span>
          );
        },
        sortUndefined: 'last',
      }),
      columnHelper.accessor('allocations', {
        header: () => <HeaderTip label="Allocations" tip="Number of active subgraph allocations. More allocations generally means broader network coverage, but quality matters more than quantity." />,
        cell: (info) => (
          <span className="font-mono text-[var(--text)]">{info.getValue()}</span>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        cell: ({ row }) => (
          <Link
            href={`/indexers/${row.original.address}`}
            className="text-[var(--accent)] hover:underline text-sm"
            onClick={(e) => e.stopPropagation()}
          >
            Details →
          </Link>
        ),
      }),
    ],
    []
  );

  const table = useReactTable({
    data: tableData,
    columns,
    state: {
      sorting,
      globalFilter,
      rowSelection,
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: nameAddressFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 25,
      },
    },
  });

  // Get selected indexers for comparison
  const selectedIndexers = useMemo(() => {
    return Object.keys(rowSelection)
      .filter((key) => rowSelection[key])
      .map((key) => {
        const row = tableData[parseInt(key)];
        return {
          id: row.address,
          name: row.name,
          stakedTokens: row.raw.stakedTokens,
          delegatedTokens: row.raw.delegatedTokens,
          allocatedTokens: row.raw.allocatedTokens,
          indexingRewardCut: row.raw.indexingRewardCut,
          queryFeeCut: row.raw.queryFeeCut,
          allocationCount: row.raw.allocationCount,
          rewardsEarned: row.raw.rewardsEarned,
          delegatorParameterCooldown: row.raw.delegatorParameterCooldown,
          lastDelegationParameterUpdate: row.raw.lastDelegationParameterUpdate,
        };
      });
  }, [rowSelection, tableData]);

  const selectedCount = Object.values(rowSelection).filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* Comparison panel */}
      {selectedCount > 0 && (
        <div className="flex items-center justify-between p-4 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-hover)]">
          <div className="flex items-center gap-3">
            <Badge variant="accent">{selectedCount} selected</Badge>
            <span className="text-sm text-[var(--text)]">
              {selectedCount >= 2
                ? 'Click "Compare" to view side-by-side'
                : 'Select at least 2 indexers to compare'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRowSelection({})}
              className={cn(
                'px-3 py-1.5 text-sm rounded-[var(--radius-button)]',
                'border border-[var(--border)] hover:bg-[var(--bg-elevated)]',
                'transition-colors'
              )}
            >
              Clear
            </button>
            <button
              onClick={() => setShowComparison(true)}
              disabled={selectedCount < 2}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-[var(--radius-button)]',
                'bg-[var(--accent)] text-white',
                'hover:opacity-90 transition-opacity',
                selectedCount < 2 && 'opacity-50 cursor-not-allowed'
              )}
            >
              Compare
            </button>
          </div>
        </div>
      )}

      {/* Comparison modal/panel */}
      {showComparison && selectedCount >= 2 && (
        <div className="relative">
          <button
            onClick={() => setShowComparison(false)}
            className="absolute top-4 right-4 z-10 p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--accent-hover)]"
          >
            <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <IndexerComparison
            indexers={selectedIndexers}
            delegationRatio={delegationRatio}
          />
        </div>
      )}

      <Card className="overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-[var(--border)] flex flex-wrap gap-3 md:gap-4 items-center">
          <div className="flex-1 min-w-0 sm:min-w-[200px]">
            <input
              type="text"
              placeholder="Search by name, address, or URL..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className={cn(
                'w-full px-3 py-2 text-sm rounded-[var(--radius-button)]',
                'bg-[var(--bg-elevated)] border border-[var(--border)]',
                'text-[var(--text)] placeholder:text-[var(--text-faint)]',
                'focus:outline-none focus:border-[var(--accent)]'
              )}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-[var(--text-muted)]">Min stake:</label>
            <div className="relative">
              <select
                value={minStake}
                onChange={(e) => setMinStake(Number(e.target.value))}
                className={cn(
                  'appearance-none pl-3 pr-8 py-2 text-sm rounded-[var(--radius-button)]',
                  'bg-[var(--bg-elevated)] border border-[var(--border)]',
                  'text-[var(--text)]',
                  'focus:outline-none focus:border-[var(--accent)]'
                )}
              >
                <option value={0}>Any</option>
                <option value={100000}>100K GRT</option>
                <option value={500000}>500K GRT</option>
                <option value={1000000}>1M GRT</option>
                <option value={5000000}>5M GRT</option>
                <option value={10000000}>10M GRT</option>
              </select>
              <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-faint)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
            </div>
          </div>
        </div>

        {/* Mobile card list */}
        <div className="block md:hidden">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-lg bg-[var(--bg-elevated)]" />
              ))}
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {table.getRowModel().rows.map((row) => {
                const d = row.original;
                return (
                  <Link
                    key={row.id}
                    href={`/indexers/${d.address}`}
                    className={cn(
                      'block p-3 rounded-lg border transition-colors',
                      row.getIsSelected()
                        ? 'border-[var(--accent)] bg-[var(--accent-dim)]'
                        : 'border-[var(--border)] hover:border-[var(--accent-hover)]'
                    )}
                  >
                    <div className="mb-2">
                      <div className="flex items-start gap-1.5">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-[var(--text)] truncate">{d.name}</p>
                          <p className="text-xs text-[var(--text-faint)] font-mono">{shortenAddress(d.address)}</p>
                        </div>
                        <div className="flex items-center gap-1 mt-1 flex-shrink-0">
                          <div className={cn(
                            'w-2 h-2 rounded-full',
                            d.reoStatus === 'eligible' ? 'bg-[var(--green)]' : 'bg-[var(--red)]'
                          )} />
                          {d.recentDelegations && (
                            <svg className="w-3 h-3 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
                            </svg>
                          )}
                          <SyncDot address={d.address} url={d.url} />
                          <DroppedChainDot address={d.address} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        {d.score !== null && (
                          <span className={cn(
                            'text-xs font-mono font-semibold',
                            d.score >= 80 ? 'text-[var(--green)]' : d.score >= 50 ? 'text-[var(--amber)]' : 'text-[var(--red)]'
                          )}>
                            {d.score}{d.scoreGrade && <span className="text-[10px] ml-0.5 opacity-70">{d.scoreGrade}</span>}
                          </span>
                        )}
                        <span className="text-[var(--text-faint)] text-xs">·</span>
                        <p className="text-xs font-mono text-[var(--text-muted)]">{formatGRT(d.selfStake)} GRT</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div className="p-1.5 rounded bg-[var(--bg-elevated)]">
                        <p className="text-[10px] text-[var(--text-faint)]">Delegated</p>
                        <p className="text-xs font-mono text-[var(--green)]">{formatGRT(d.delegated)}</p>
                      </div>
                      <div className="p-1.5 rounded bg-[var(--bg-elevated)]">
                        <p className="text-[10px] text-[var(--text-faint)]">Cut</p>
                        <p className={cn(
                          'text-xs font-mono flex items-center justify-center gap-1',
                          isGreedyCut(d.rewardCut) ? 'text-[var(--red)] font-semibold' : 'text-[var(--text)]'
                        )}>
                          {formatPPM(d.rewardCut)}
                          {(() => {
                            const daysSince = (Date.now() / 1000 - d.raw.lastDelegationParameterUpdate) / 86400;
                            return daysSince <= 30 ? (
                              <span className={cn('w-1.5 h-1.5 rounded-full', daysSince <= 7 ? 'bg-[var(--red)]' : 'bg-[var(--amber)]')} />
                            ) : null;
                          })()}
                        </p>
                      </div>
                      <div className="p-1.5 rounded bg-[var(--bg-elevated)]">
                        <p className="text-[10px] text-[var(--text-faint)]">APY 90d</p>
                        <p className={cn('text-xs font-mono', d.rollingAPY90d && d.rollingAPY90d > 5 ? 'text-[var(--green)]' : 'text-[var(--text)]')}>
                          {d.rollingAPY90d !== null ? `${d.rollingAPY90d.toFixed(2)}%` : d.apr !== null ? `${d.apr.toFixed(2)}%` : '—'}
                        </p>
                      </div>
                      <div className="p-1.5 rounded bg-[var(--bg-elevated)]">
                        <p className="text-[10px] text-[var(--text-faint)]">Capacity</p>
                        <p className={cn('text-xs font-mono', d.capacity > 90 ? 'text-[var(--amber)]' : 'text-[var(--text)]')}>
                          {d.capacity.toFixed(0)}%
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--bg-elevated)]">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={cn(
                        'px-4 py-3 text-left text-[11px] font-medium text-[var(--text-muted)]',
                        'border-r border-[var(--border)]/20 last:border-r-0',
                        header.column.getCanSort() && 'cursor-pointer select-none hover:text-[var(--text)]'
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() && (
                          <span className="text-[var(--accent)]">
                            {header.column.getIsSorted() === 'asc' ? '\u2191' : '\u2193'}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    {columns.map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className="h-4 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      'hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer',
                      row.getIsSelected() && 'bg-[var(--accent-dim)]',
                      !row.getIsSelected() && isGreedyCut(row.original.rewardCut) && 'bg-[rgba(255,80,80,0.04)]'
                    )}
                    onClick={(e) => {
                      // Don't navigate if clicking interactive elements
                      if ((e.target as HTMLElement).closest('a, button, input, [role="button"]')) return;
                      const url = `/indexers/${row.original.address}`;
                      if (e.ctrlKey || e.metaKey || e.button === 1) {
                        window.open(url, '_blank');
                      } else {
                        window.location.href = url;
                      }
                    }}
                    onAuxClick={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        window.open(`/indexers/${row.original.address}`, '_blank');
                      }
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-4 border-r border-[var(--border)]/20 last:border-r-0">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-[var(--border)] flex items-center justify-between">
          <div className="text-sm text-[var(--text-muted)]">
            <span className="hidden sm:inline">Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{' '}
            {Math.min(
              (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
              table.getFilteredRowModel().rows.length
            )}{' '}
            of </span>{table.getFilteredRowModel().rows.length} indexers
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className={cn(
                'px-3 py-1.5 text-sm rounded-[var(--radius-button)]',
                'border border-[var(--border)]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'hover:bg-[var(--bg-elevated)] transition-colors'
              )}
            >
              Prev
            </button>
            <span className="text-sm text-[var(--text-muted)]">
              {table.getState().pagination.pageIndex + 1}/{table.getPageCount()}
            </span>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className={cn(
                'px-3 py-1.5 text-sm rounded-[var(--radius-button)]',
                'border border-[var(--border)]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'hover:bg-[var(--bg-elevated)] transition-colors'
              )}
            >
              Next
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
