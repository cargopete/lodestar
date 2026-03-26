'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useLeaderboard, useEnrichedIndexers } from '@/hooks/useNetworkStats';
import { Card } from '@/components/ui/Card';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { Pagination } from '@/components/ui/Pagination';
import { cn, shortenAddress } from '@/lib/utils';
import type { LeaderboardEntry } from '@/lib/scoring';

const PAGE_SIZE = 25;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatPeriod(periodStart: string): string {
  const d = new Date(periodStart + 'T00:00:00Z');
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--green)';
  if (score >= 60) return 'var(--accent)';
  if (score >= 40) return 'var(--amber)';
  return 'var(--red)';
}

function barWidth(score: number, max: number): string {
  if (max === 0) return '0%';
  return `${Math.min(100, (score / max) * 100)}%`;
}

// Component score sections for the expanded breakdown
const SCORE_SECTIONS = [
  {
    label: 'Network Contribution',
    max: 35,
    items: [
      { key: 'query_fee_score' as const, label: 'Query Fees', max: 20 },
      { key: 'allocation_efficiency_score' as const, label: 'Allocation Efficiency', max: 15 },
    ],
  },
  {
    label: 'Economics',
    max: 25,
    items: [
      { key: 'delegator_apr_score' as const, label: 'Delegator APR', max: 10 },
      { key: 'effective_cut_score' as const, label: 'Effective Cut Fairness', max: 10 },
      { key: 'capacity_score' as const, label: 'Delegation Capacity', max: 5 },
    ],
  },
  {
    label: 'Trust & Stability',
    max: 20,
    items: [
      { key: 'cut_stability_score' as const, label: 'Cut Stability', max: 12 },
      { key: 'tenure_bonus' as const, label: 'Tenure', max: 5 },
      { key: 'retention_score' as const, label: 'Delegation Retention', max: 3 },
    ],
  },
  {
    label: 'Protocol Health',
    max: 6,
    items: [
      { key: 'reo_score' as const, label: 'REO Eligibility', max: 4 },
      { key: 'allocation_breadth_score' as const, label: 'Allocation Breadth', max: 2 },
    ],
  },
] as const;

export default function LeaderboardPage() {
  const { data, isLoading, isError } = useLeaderboard();
  const { data: enrichedData } = useEnrichedIndexers();
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Build name lookup from enriched indexers
  const nameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (enrichedData?.indexers) {
      for (const idx of enrichedData.indexers) {
        if (idx.name) map.set(idx.id.toLowerCase(), idx.name);
      }
    }
    return map;
  }, [enrichedData]);

  const entries = data?.entries ?? [];

  const paginatedEntries = useMemo(() => {
    const start = page * PAGE_SIZE;
    return entries.slice(start, start + PAGE_SIZE);
  }, [entries, page]);

  // Summary stats
  const topScore = entries[0]?.final_score ?? 0;
  const medianScore = entries.length > 0 ? entries[Math.floor(entries.length / 2)]?.final_score ?? 0 : 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !data || entries.length === 0) {
    return (
      <div className="text-center py-24">
        <h2 className="text-xl font-semibold text-[var(--text)] mb-2">Leaderboard Not Available</h2>
        <p className="text-[var(--text-muted)]">
          Monthly scores have not been computed yet. Check back after the 1st of the month.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-[var(--text)]">Indexer Leaderboard</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Monthly rankings based on 12 scoring dimensions across network contribution, economics, trust, and protocol health.
          {data.periodStart && (
            <span className="text-[var(--text)]"> {formatPeriod(data.periodStart)}</span>
          )}
        </p>
      </div>

      {/* Overview stats */}
      <StatGrid>
        <StatCard label="Indexers Ranked" value={String(entries.length)} />
        <StatCard
          label="Top Score"
          value={topScore.toFixed(1)}
          delta={{ value: `/ 100`, positive: topScore >= 70 }}
        />
        <StatCard label="Median Score" value={medianScore.toFixed(1)} />
      </StatGrid>

      {/* Mobile cards */}
      <div className="block md:hidden space-y-3">
        {paginatedEntries.map((entry) => (
          <MobileCard
            key={entry.indexer_address}
            entry={entry}
            name={nameMap.get(entry.indexer_address.toLowerCase())}
            expanded={expanded === entry.indexer_address}
            onToggle={() => setExpanded(expanded === entry.indexer_address ? null : entry.indexer_address)}
          />
        ))}
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={entries.length}
          onPageChange={setPage}
        />
      </div>

      {/* Desktop table */}
      <Card className="overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--bg-elevated)]">
              <tr>
                <th className={TH_CLASS}>Rank</th>
                <th className={cn(TH_CLASS, 'text-left')}>Indexer</th>
                <th className={TH_CLASS}>Score</th>
                <th className={cn(TH_CLASS, 'hidden lg:table-cell')}>Network</th>
                <th className={cn(TH_CLASS, 'hidden lg:table-cell')}>Economics</th>
                <th className={cn(TH_CLASS, 'hidden lg:table-cell')}>Trust</th>
                <th className={cn(TH_CLASS, 'hidden lg:table-cell')}>Health</th>
              </tr>
            </thead>
            <tbody>
              {paginatedEntries.map((entry) => (
                <DesktopRow
                  key={entry.indexer_address}
                  entry={entry}
                  name={nameMap.get(entry.indexer_address.toLowerCase())}
                  expanded={expanded === entry.indexer_address}
                  onToggle={() => setExpanded(expanded === entry.indexer_address ? null : entry.indexer_address)}
                />
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={entries.length}
          onPageChange={setPage}
        />
      </Card>

      {/* Info panel */}
      <Card>
        <div className="p-4 space-y-4">
          <div>
            <h4 className="font-semibold text-[var(--text)] mb-2">About the Leaderboard</h4>
            <p className="text-sm text-[var(--text-muted)]">
              Scores are computed monthly using percentile normalisation (p10/p90) across all active indexers.
              Each indexer is scored on 10 dimensions grouped into 4 components: Network Contribution (35pts),
              Economics (25pts), Trust &amp; Stability (20pts), and Protocol Health (6pts).
              Community votes (10pts) are reserved for a future phase. Penalties are multiplicative
              and stack — an indexer with multiple infractions can see their score significantly reduced.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-[var(--text)] mb-2">Indexer of the Month</h4>
            <p className="text-sm text-[var(--text-muted)]">
              The #1 ranked indexer at the end of each month earns the &ldquo;Indexer of the Month&rdquo; title
              and wears the badge for the following month.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────

const TH_CLASS =
  'px-4 py-3 text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-[0.06em] select-none text-right';

// ── Desktop row ───────────────────────────────────────────

function DesktopRow({
  entry,
  name,
  expanded,
  onToggle,
}: {
  entry: LeaderboardEntry;
  name: string | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  const networkScore = entry.query_fee_score + entry.allocation_efficiency_score;
  const economicsScore = entry.delegator_apr_score + entry.effective_cut_score + entry.capacity_score;
  const trustScore = entry.cut_stability_score + entry.tenure_bonus + entry.retention_score;
  const healthScore = entry.reo_score + entry.allocation_breadth_score;

  return (
    <>
      <tr
        className="border-b border-[0.5px] border-[var(--border)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-4 py-3 text-center">
          <RankBadge rank={entry.rank ?? 0} />
        </td>
        <td className="px-4 py-3">
          <Link
            href={`/indexers/${entry.indexer_address}`}
            className="hover:text-[var(--accent)] transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-sm font-medium text-[var(--text)]">
              {name ?? shortenAddress(entry.indexer_address)}
            </span>
            {name && (
              <span className="text-xs text-[var(--text-faint)] ml-2 font-mono">
                {shortenAddress(entry.indexer_address)}
              </span>
            )}
          </Link>
        </td>
        <td className="px-4 py-3 text-right">
          <span className="font-mono text-sm font-semibold" style={{ color: scoreColor(entry.final_score) }}>
            {entry.final_score.toFixed(1)}
          </span>
        </td>
        <td className="px-4 py-3 text-right hidden lg:table-cell">
          <ComponentCell score={networkScore} max={35} />
        </td>
        <td className="px-4 py-3 text-right hidden lg:table-cell">
          <ComponentCell score={economicsScore} max={25} />
        </td>
        <td className="px-4 py-3 text-right hidden lg:table-cell">
          <ComponentCell score={trustScore} max={20} />
        </td>
        <td className="px-4 py-3 text-right hidden lg:table-cell">
          <ComponentCell score={healthScore} max={6} />
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-[0.5px] border-[var(--border)]">
          <td colSpan={7} className="px-4 py-4 bg-[var(--bg-elevated)]">
            <ScoreBreakdown entry={entry} />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Mobile card ───────────────────────────────────────────

function MobileCard({
  entry,
  name,
  expanded,
  onToggle,
}: {
  entry: LeaderboardEntry;
  name: string | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Card className="cursor-pointer" onClick={onToggle}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <RankBadge rank={entry.rank ?? 0} />
          <div>
            <Link
              href={`/indexers/${entry.indexer_address}`}
              className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent)]"
              onClick={(e) => e.stopPropagation()}
            >
              {name ?? shortenAddress(entry.indexer_address)}
            </Link>
            {name && (
              <p className="text-xs text-[var(--text-faint)] font-mono">
                {shortenAddress(entry.indexer_address)}
              </p>
            )}
          </div>
        </div>
        <div className="text-right">
          <span className="font-mono text-lg font-bold" style={{ color: scoreColor(entry.final_score) }}>
            {entry.final_score.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Mini bar breakdown */}
      <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-[var(--bg)]">
        <div
          className="rounded-l-full bg-[var(--accent)]"
          style={{ width: barWidth(entry.query_fee_score + entry.allocation_efficiency_score, 86) }}
          title="Network"
        />
        <div
          className="bg-[var(--green)]"
          style={{ width: barWidth(entry.delegator_apr_score + entry.effective_cut_score + entry.capacity_score, 86) }}
          title="Economics"
        />
        <div
          className="bg-[var(--cyan)]"
          style={{ width: barWidth(entry.cut_stability_score + entry.tenure_bonus + entry.retention_score, 86) }}
          title="Trust"
        />
        <div
          className="rounded-r-full bg-[var(--amber)]"
          style={{ width: barWidth(entry.reo_score + entry.allocation_breadth_score, 86) }}
          title="Health"
        />
      </div>
      <div className="flex justify-between mt-1.5 text-[10px] text-[var(--text-faint)]">
        <span>Network</span>
        <span>Economics</span>
        <span>Trust</span>
        <span>Health</span>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-[var(--border)]">
          <ScoreBreakdown entry={entry} />
        </div>
      )}
    </Card>
  );
}

// ── Score breakdown (shared between mobile/desktop) ───────

function ScoreBreakdown({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {SCORE_SECTIONS.map((section) => {
        const sectionTotal = section.items.reduce((sum, item) => sum + entry[item.key], 0);
        return (
          <div key={section.label}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-[var(--text)]">{section.label}</span>
              <span className="text-xs font-mono text-[var(--text-muted)]">
                {sectionTotal.toFixed(1)} / {section.max}
              </span>
            </div>
            <div className="space-y-1.5">
              {section.items.map((item) => {
                const value = entry[item.key];
                const pct = item.max > 0 ? (value / item.max) * 100 : 0;
                return (
                  <div key={item.key}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[var(--text-faint)]">{item.label}</span>
                      <span className="font-mono text-[var(--text-muted)]">
                        {value.toFixed(1)} / {item.max}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--bg)] mt-0.5">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, pct)}%`,
                          backgroundColor: pct >= 75 ? 'var(--green)' : pct >= 40 ? 'var(--accent)' : 'var(--text-faint)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Small components ──────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold font-mono">
        1
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-400/20 text-gray-300 text-xs font-bold font-mono">
        2
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-orange-600/20 text-orange-400 text-xs font-bold font-mono">
        3
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 text-xs font-mono text-[var(--text-muted)]">
      {rank}
    </span>
  );
}

function ComponentCell({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? (score / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2 justify-end">
      <div className="w-16 h-1.5 rounded-full bg-[var(--bg)] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, pct)}%`,
            backgroundColor: pct >= 75 ? 'var(--green)' : pct >= 40 ? 'var(--accent)' : 'var(--text-faint)',
          }}
        />
      </div>
      <span className="font-mono text-xs text-[var(--text-muted)] w-10 text-right">
        {score.toFixed(1)}
      </span>
    </div>
  );
}
