'use client';

import { useState, useMemo, useCallback, Suspense } from 'react';
import { ChartSkeleton } from '@/components/ui/ChartSkeleton';
import { useSearchParams } from 'next/navigation';
import { useIndexers, useEnrichedIndexers, useNetworkStats } from '@/hooks/useNetworkStats';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import {
  weiToGRT,
  formatGRT,
  formatPPM,
  shortenAddress,
  resolveIndexerName,
  formatRelativeTime,
  cn,
} from '@/lib/utils';
import {
  calculateDelegationCapacity,
  calculateEstimatedAPR,
} from '@/lib/rewards';
import type { Indexer } from '@/lib/queries';

// ---------- types ----------

interface ProcessedIndexer {
  id: string;
  name: string;
  selfStake: number;
  delegated: number;
  delegationCapacity: number;
  rewardCut: number;
  effectiveCut: number;
  queryFeeCut: number;
  estimatedAPR: number;
  totalRewards: number;
  allocations: number;
  createdAt: number;
  raw: Indexer;
}

interface MetricDef {
  key: keyof ProcessedIndexer;
  label: string;
  format: 'grt' | 'percent' | 'ppm' | 'number' | 'date';
  highlight: 'higher' | 'lower';
}

const METRICS: MetricDef[] = [
  { key: 'selfStake', label: 'Self Stake', format: 'grt', highlight: 'higher' },
  { key: 'delegated', label: 'Total Delegated', format: 'grt', highlight: 'higher' },
  { key: 'delegationCapacity', label: 'Delegation Capacity', format: 'percent', highlight: 'lower' },
  { key: 'rewardCut', label: 'Reward Cut (Raw)', format: 'ppm', highlight: 'lower' },
  { key: 'effectiveCut', label: 'Effective Cut', format: 'percent', highlight: 'lower' },
  { key: 'queryFeeCut', label: 'Query Fee Cut (%)', format: 'ppm', highlight: 'lower' },
  { key: 'estimatedAPR', label: 'Estimated Delegator APR', format: 'percent', highlight: 'higher' },
  { key: 'totalRewards', label: 'Total Rewards Earned', format: 'grt', highlight: 'higher' },
  { key: 'allocations', label: 'Active Allocations', format: 'number', highlight: 'higher' },
  { key: 'createdAt', label: 'Active Since', format: 'date', highlight: 'lower' },
];

// ---------- helpers ----------

function processIndexer(
  indexer: Indexer,
  delegationRatio: number,
  networkRewardsPerYear: number,
): ProcessedIndexer {
  const selfStake = weiToGRT(indexer.stakedTokens) - weiToGRT(indexer.lockedTokens ?? '0');
  const delegated = weiToGRT(indexer.delegatedTokens);
  const totalRewards = weiToGRT(indexer.rewardsEarned);

  const capacity = calculateDelegationCapacity(selfStake, delegated, delegationRatio);
  const totalStake = selfStake + delegated;
  const indexerRewardsPerYear = totalStake > 0
    ? (totalStake / 3_000_000_000) * networkRewardsPerYear
    : 0;

  const estimatedAPR = calculateEstimatedAPR(
    indexerRewardsPerYear,
    indexer.indexingRewardCut,
    delegated,
    10_000, // reference delegation of 10K GRT
  );

  const rawCut = indexer.indexingRewardCut / 1_000_000;
  const effectiveCut = rawCut * 100;

  return {
    id: indexer.id,
    name: resolveIndexerName(indexer.account, indexer.id),
    selfStake,
    delegated,
    delegationCapacity: capacity.utilizationPercent,
    rewardCut: indexer.indexingRewardCut,
    effectiveCut,
    queryFeeCut: indexer.queryFeeCut,
    estimatedAPR,
    totalRewards,
    allocations: indexer.allocationCount,
    createdAt: indexer.createdAt,
    raw: indexer,
  };
}

function formatMetric(value: unknown, format: MetricDef['format']): string {
  switch (format) {
    case 'grt':
      return `${formatGRT(value as number)} GRT`;
    case 'percent':
      return `${(value as number).toFixed(2)}%`;
    case 'ppm':
      return formatPPM(value as number);
    case 'number':
      return String(value);
    case 'date':
      return formatRelativeTime(value as number);
    default:
      return String(value);
  }
}

// ---------- search dropdown ----------

interface IndexerSearchProps {
  indexers: Indexer[];
  nameMap?: Map<string, string>;
  selected: string | null;
  onSelect: (id: string) => void;
  placeholder?: string;
}

function IndexerSearch({ indexers, nameMap, selected, onSelect, placeholder }: IndexerSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!query) return indexers.slice(0, 20);
    const q = query.toLowerCase();
    return indexers.filter(
      (ix) =>
        ix.id.toLowerCase().includes(q) ||
        (ix.account?.defaultDisplayName ?? '').toLowerCase().includes(q) ||
        (nameMap?.get(ix.id) ?? '').toLowerCase().includes(q),
    ).slice(0, 20);
  }, [indexers, nameMap, query]);

  const selectedName = useMemo(() => {
    if (!selected) return null;
    const enrichedName = nameMap?.get(selected);
    if (enrichedName) return enrichedName;
    const ix = indexers.find((i) => i.id === selected);
    return resolveIndexerName(ix?.account, selected);
  }, [indexers, nameMap, selected]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'w-full px-3 py-2 text-sm rounded-[var(--radius-button)] text-left',
          'bg-[var(--bg-elevated)] border-[0.5px] border-[var(--border)]',
          'text-[var(--text)] hover:border-[var(--accent)] transition-colors',
          !selected && 'text-[var(--text-faint)]',
        )}
      >
        {selectedName || placeholder || 'Select indexer...'}
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-[var(--radius-card)] border-[0.5px] border-[var(--border)] bg-[var(--bg-surface)] shadow-lg">
          <div className="p-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or address..."
              autoFocus
              className={cn(
                'w-full px-3 py-2 text-sm rounded-[var(--radius-button)]',
                'bg-[var(--bg-elevated)] border-[0.5px] border-[var(--border)]',
                'text-[var(--text)] placeholder:text-[var(--text-faint)]',
                'focus:outline-none focus:border-[var(--accent)]',
              )}
            />
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filtered.map((ix) => {
              const name = nameMap?.get(ix.id) || resolveIndexerName(ix.account, ix.id);
              return (
                <button
                  key={ix.id}
                  type="button"
                  onClick={() => {
                    onSelect(ix.id);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={cn(
                    'w-full px-3 py-2 text-left text-sm hover:bg-[var(--bg-elevated)] transition-colors',
                    ix.id === selected && 'bg-[var(--accent-dim)]',
                  )}
                >
                  <p className="text-[var(--text)]">{name}</p>
                  <p className="text-xs font-mono text-[var(--text-faint)]">{shortenAddress(ix.id)}</p>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-sm text-[var(--text-faint)] text-center">No indexers found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- page ----------

export default function ComparePage() {
  return (
    <Suspense fallback={<ChartSkeleton height="300px" />}>
      <CompareContent />
    </Suspense>
  );
}

function CompareContent() {
  const searchParams = useSearchParams();
  const initialA = searchParams.get('a');
  const initialB = searchParams.get('b');
  const initialC = searchParams.get('c');

  const [selections, setSelections] = useState<(string | null)[]>(() => {
    const init: (string | null)[] = [initialA, initialB];
    if (initialC) init.push(initialC);
    return init;
  });

  const { data: indexersData, isLoading: indexersLoading } = useIndexers({
    first: 100,
    orderBy: 'stakedTokens',
    orderDirection: 'desc',
  });
  const { data: enrichedData } = useEnrichedIndexers();
  const { data: networkData } = useNetworkStats();

  const delegationRatio = networkData?.graphNetwork?.delegationRatio ?? 16;
  const indexers = indexersData?.indexers ?? [];

  // Build maps from enriched data (has ENS names + allocation-level APR)
  const { nameMap, aprMap } = useMemo(() => {
    const names = new Map<string, string>();
    const aprs = new Map<string, number>();
    const enrichedList = enrichedData && 'indexers' in enrichedData ? enrichedData.indexers : enrichedData ?? [];
    for (const e of enrichedList) {
      names.set(e.id, e.name);
      aprs.set(e.id, e.delegatorAPR);
    }
    return { nameMap: names, aprMap: aprs };
  }, [enrichedData]);

  const setSlot = useCallback((idx: number, id: string) => {
    setSelections((prev) => {
      const next = [...prev];
      next[idx] = id;
      return next;
    });
  }, []);

  const addSlot = useCallback(() => {
    setSelections((prev) => (prev.length < 3 ? [...prev, null] : prev));
  }, []);

  const removeSlot = useCallback((idx: number) => {
    setSelections((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  // Process selected indexers — overlay enriched APR when available
  const processed: (ProcessedIndexer | null)[] = useMemo(() => {
    return selections.map((sel) => {
      if (!sel) return null;
      const ix = indexers.find((i) => i.id === sel);
      if (!ix) return null;
      const p = processIndexer(ix, delegationRatio, 300_000_000);
      const enrichedAPR = aprMap.get(sel);
      if (enrichedAPR !== undefined) {
        p.estimatedAPR = enrichedAPR;
        p.name = nameMap.get(sel) ?? p.name;
      }
      return p;
    });
  }, [selections, indexers, delegationRatio, aprMap, nameMap]);

  // Best values per metric
  const bestValues = useMemo(() => {
    const active = processed.filter(Boolean) as ProcessedIndexer[];
    if (active.length < 2) return {} as Record<string, number>;

    const result: Record<string, number> = {};
    for (const metric of METRICS) {
      const vals = active.map((p) => p[metric.key] as number);
      result[metric.key] =
        metric.highlight === 'higher' ? Math.max(...vals) : Math.min(...vals);
    }
    return result;
  }, [processed]);

  if (indexersLoading) {
    return <ChartSkeleton height="300px" />;
  }

  return (
    <div className="space-y-6">
      {/* Selection row */}
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${selections.length}, minmax(0, 1fr))${selections.length < 3 ? ' auto' : ''}` }}>
        {selections.map((sel, idx) => (
          <div key={idx} className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-[var(--text-muted)]">
                Indexer {String.fromCharCode(65 + idx)}
              </label>
              {selections.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeSlot(idx)}
                  className="text-xs text-[var(--text-faint)] hover:text-[var(--red-text)] transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
            <IndexerSearch
              indexers={indexers}
              nameMap={nameMap}
              selected={sel}
              onSelect={(id) => setSlot(idx, id)}
            />
          </div>
        ))}

        {selections.length < 3 && (
          <div className="flex items-end">
            <button
              type="button"
              onClick={addSlot}
              className={cn(
                'px-4 py-2 text-sm rounded-[var(--radius-button)]',
                'border-[0.5px] border-dashed border-[var(--border-mid)]',
                'text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent-text)]',
                'transition-colors',
              )}
            >
              + Add indexer
            </button>
          </div>
        )}
      </div>

      {/* Comparison table */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Side-by-Side Comparison</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[var(--bg-elevated)]">
                  <th className="px-4 py-3 text-left text-[11px] font-medium text-[var(--text-muted)] sticky left-0 bg-[var(--bg-elevated)] z-10">
                    Metric
                  </th>
                  {processed.map((p, idx) => (
                    <th
                      key={idx}
                      className="px-4 py-3 text-center text-[11px] font-medium text-[var(--text)] min-w-[180px]"
                    >
                      {p ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="font-semibold text-sm normal-case">{p.name}</span>
                          <span className="text-[var(--text-faint)] font-mono text-xs normal-case">
                            {shortenAddress(p.id)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[var(--text-faint)] normal-case">Not selected</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map((metric) => (
                  <tr
                    key={metric.key}
                    className="border-b border-[0.5px] border-[var(--border)] hover:bg-[var(--bg-elevated)] transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-[var(--text-muted)] sticky left-0 bg-[var(--bg-surface)] z-10">
                      {metric.label}
                    </td>
                    {processed.map((p, idx) => {
                      if (!p) {
                        return (
                          <td key={idx} className="px-4 py-3 text-center text-sm text-[var(--text-faint)]">
                            --
                          </td>
                        );
                      }

                      const value = p[metric.key];
                      const isBest =
                        Object.keys(bestValues).length > 0 &&
                        value === bestValues[metric.key as string];

                      return (
                        <td
                          key={idx}
                          className={cn(
                            'px-4 py-3 text-center font-mono text-sm',
                            isBest ? 'text-[var(--accent-text)] font-semibold' : 'text-[var(--text)]',
                          )}
                        >
                          {formatMetric(value, metric.format)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="px-4 py-3 border-t border-[0.5px] border-[var(--border)] bg-[var(--bg-elevated)]">
            <p className="text-xs text-[var(--text-faint)]">
              Best value in each row is highlighted in accent colour. APR uses allocation-level
              calculations from the enriched pipeline when available.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
