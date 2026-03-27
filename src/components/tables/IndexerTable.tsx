'use client';

import { useState, useMemo } from 'react';
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
import { useEnrichedIndexers, useIndexers, useNetworkStats } from '@/hooks/useNetworkStats';
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

export function IndexerTable() {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'score', desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [minStake, setMinStake] = useState(0);
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
          raw: indexer,
        };
      })
      .filter((row) => row.selfStake >= minStake);
  }, [enrichedData, hasEnriched, indexersData, delegationRatio, minStake]);

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
        header: 'Score',
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
      columnHelper.accessor('selfStake', {
        header: 'Self-Stake',
        cell: (info) => (
          <span className="font-mono text-[var(--text)]">
            {formatGRT(info.getValue())} GRT
          </span>
        ),
      }),
      columnHelper.accessor('delegated', {
        header: 'Delegated',
        cell: (info) => (
          <span className="font-mono text-[var(--green)]">
            {formatGRT(info.getValue())} GRT
          </span>
        ),
      }),
      columnHelper.accessor('capacity', {
        header: 'Capacity',
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
        header: 'Reward Cut',
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
      columnHelper.accessor('apr', {
        header: 'APR',
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
      columnHelper.accessor('rollingAPY30d', {
        header: 'APY 30d',
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
                <span className="block text-[var(--text-muted)]">90d APY: {row.rollingAPY90d !== null ? `${row.rollingAPY90d.toFixed(2)}%` : '—'}</span>
                <span className="block text-[var(--text-faint)] mt-0.5">Instant APR: {row.apr !== null ? `${row.apr.toFixed(2)}%` : '—'}</span>
              </span>
            </span>
          );
        },
        sortUndefined: 'last',
      }),
      columnHelper.accessor('feesCollected', {
        header: 'Fees',
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
        header: 'Allocations',
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
            <select
              value={minStake}
              onChange={(e) => setMinStake(Number(e.target.value))}
              className={cn(
                'px-3 py-2 text-sm rounded-[var(--radius-button)]',
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
                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0 mr-2 flex items-start gap-1.5">
                        <div>
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
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {d.score !== null && (
                          <span className={cn(
                            'text-sm font-mono font-semibold',
                            d.score >= 80 ? 'text-[var(--green)]' : d.score >= 50 ? 'text-[var(--amber)]' : 'text-[var(--red)]'
                          )}>
                            {d.score}{d.scoreGrade && <span className="text-[10px] ml-0.5 opacity-70">{d.scoreGrade}</span>}
                          </span>
                        )}
                        <p className="text-sm font-mono text-[var(--text)]">{formatGRT(d.selfStake)}</p>
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
                        <p className="text-[10px] text-[var(--text-faint)]">APY 30d</p>
                        <p className={cn('text-xs font-mono', d.rollingAPY30d && d.rollingAPY30d > 5 ? 'text-[var(--green)]' : 'text-[var(--text)]')}>
                          {d.rollingAPY30d !== null ? `${d.rollingAPY30d.toFixed(2)}%` : d.apr !== null ? `${d.apr.toFixed(2)}%` : '—'}
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
                        'px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider',
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
