'use client';

import { useState, useMemo, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLeaderboard, useLeaderboardPeriods, useEnrichedIndexers } from '@/hooks/useNetworkStats';
import { Card } from '@/components/ui/Card';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { Pagination } from '@/components/ui/Pagination';
import { cn, shortenAddress } from '@/lib/utils';
import type { LeaderboardEntry } from '@/lib/scoring';
import { VoteButton } from '@/components/VoteButton';
import { VoterList, VoteCount } from '@/components/VoterList';
import { useVotes } from '@/hooks/useVoting';
import { getCurrentPeriod } from '@/lib/voting';

const PAGE_SIZE = 25;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Month name only — used in the period selector dropdown */
function formatPeriod(periodStart: string): string {
  const d = new Date(periodStart.length === 10 ? periodStart + 'T00:00:00Z' : periodStart);
  if (isNaN(d.getTime())) return periodStart;
  return MONTH_NAMES[d.getUTCMonth()];
}

/** "March 2026" — used in the banner */
function formatPeriodFull(periodStart: string): string {
  const d = new Date(periodStart.length === 10 ? periodStart + 'T00:00:00Z' : periodStart);
  if (isNaN(d.getTime())) return periodStart;
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

const MAX_SUBTOTAL = 81;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VoteTallies = { indexer_address: string; weighted_votes: number }[];

/** Pure function: compute live score + community score for one entry */
function computeLiveScores(
  entry: LeaderboardEntry,
  tallies: VoteTallies | undefined,
  maxWeighted: number,
): { liveScore: number; liveCommunityScore: number } {
  if (!tallies?.length || maxWeighted === 0)
    return { liveScore: entry.final_score, liveCommunityScore: entry.community_vote_score };
  const tally = tallies.find(
    (t) => t.indexer_address.toLowerCase() === entry.indexer_address.toLowerCase()
  );
  const liveCommunityScore = ((tally?.weighted_votes ?? 0) / maxWeighted) * 10;
  const delta = liveCommunityScore - entry.community_vote_score;
  if (delta === 0) return { liveScore: entry.final_score, liveCommunityScore };
  const adjusted = entry.final_score + (delta * entry.penalty_multiplier / MAX_SUBTOTAL) * 100;
  return { liveScore: Math.min(100, Math.max(0, +adjusted.toFixed(2))), liveCommunityScore };
}

// Component score sections for the expanded breakdown
const SCORE_SECTIONS = [
  {
    label: 'Network Service',
    max: 40,
    items: [
      { key: 'allocation_breadth_score' as const, label: 'Subgraph Coverage', max: 20 },
      { key: 'query_fee_score' as const, label: 'Query Fees', max: 10 },
      { key: 'allocation_efficiency_score' as const, label: 'Allocation Efficiency', max: 10 },
    ],
  },
  {
    label: 'Community',
    max: 10,
    items: [
      { key: 'community_vote_score' as const, label: 'Community Votes', max: 10 },
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
      { key: 'reo_score' as const, label: 'REO Eligibility', max: 6 },
    ],
  },
  {
    label: 'Economics',
    max: 5,
    items: [
      { key: 'capacity_score' as const, label: 'Delegation Capacity', max: 5 },
    ],
  },
] as const;

function periodToYYYYMM(start: string): string {
  const d = new Date(start.length === 10 ? start + 'T00:00:00Z' : start);
  if (isNaN(d.getTime())) return start.slice(0, 7);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function LeaderboardPage() {
  return (
    <Suspense>
      <LeaderboardContent />
    </Suspense>
  );
}

function LeaderboardContent() {
  const searchParams = useSearchParams();
  const highlightParam = searchParams.get('highlight')?.toLowerCase() ?? null;

  const [selectedPeriod, setSelectedPeriod] = useState<string | undefined>(undefined);
  const { data, isLoading, isError } = useLeaderboard(selectedPeriod);
  const { data: periodsData } = useLeaderboardPeriods();
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

  // Derive the voting period from the data (YYYY-MM of the scores being viewed)
  const votePeriod = useMemo(() => {
    if (!data?.periodStart) return getCurrentPeriod();
    const ps = typeof data.periodStart === 'string' ? data.periodStart : String(data.periodStart);
    return ps.slice(0, 7); // "2026-03-01" → "2026-03"
  }, [data?.periodStart]);
  const isCurrentPeriod = votePeriod === getCurrentPeriod();

  const { data: votes } = useVotes(votePeriod);
  const rawEntries = data?.entries ?? [];

  // Compute live scores, re-sort, and assign live ranks
  // Only overlay live vote tallies when viewing the current scoring period
  const entries = useMemo(() => {
    if (!rawEntries.length) return rawEntries;
    if (!isCurrentPeriod) {
      // Historical: use stored scores as-is, just assign ranks
      const sorted = [...rawEntries].sort((a, b) => {
        const diff = b.final_score - a.final_score;
        if (diff !== 0) return diff;
        return b.months_active - a.months_active;
      });
      sorted.forEach((e, i) => { e.rank = i + 1; });
      return sorted;
    }
    const tallies = votes?.tallies as VoteTallies | undefined;
    const maxWeighted = tallies?.length
      ? Math.max(...tallies.map((t) => t.weighted_votes))
      : 0;
    const withLive = rawEntries.map((e) => {
      const { liveScore } = computeLiveScores(e, tallies, maxWeighted);
      return { ...e, final_score: liveScore };
    });
    withLive.sort((a, b) => {
      const diff = b.final_score - a.final_score;
      if (diff !== 0) return diff;
      // Tiebreaker: more months active (longer tenure wins)
      return b.months_active - a.months_active;
    });
    withLive.forEach((e, i) => { e.rank = i + 1; });
    return withLive;
  }, [rawEntries, votes, isCurrentPeriod]);

  const paginatedEntries = useMemo(() => {
    const start = page * PAGE_SIZE;
    return entries.slice(start, start + PAGE_SIZE);
  }, [entries, page]);

  // Resolve highlight param to a canonical address (entries must be computed first)
  const highlightAddress = useMemo(() => {
    if (!highlightParam || !entries.length) return null;
    const byAddr = entries.find((e) => e.indexer_address.toLowerCase() === highlightParam);
    if (byAddr) return byAddr.indexer_address;
    const byName = entries.find(
      (e) => (nameMap.get(e.indexer_address.toLowerCase()) ?? '').toLowerCase() === highlightParam,
    );
    return byName?.indexer_address ?? null;
  }, [highlightParam, entries, nameMap]);

  // Jump to the page containing the highlighted entry (once, after entries load)
  const hasJumped = useRef(false);
  useEffect(() => {
    if (hasJumped.current || !highlightAddress || !entries.length) return;
    const idx = entries.findIndex(
      (e) => e.indexer_address.toLowerCase() === highlightAddress.toLowerCase(),
    );
    if (idx >= 0) {
      setPage(Math.floor(idx / PAGE_SIZE));
      hasJumped.current = true;
    }
  }, [highlightAddress, entries]);

  // Scroll highlighted row into view after page change settles
  useEffect(() => {
    if (!highlightAddress) return;
    const timer = setTimeout(() => {
      document.querySelector('[data-highlight-row]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => clearTimeout(timer);
  }, [highlightAddress, page]);

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

  // Badge holder: API returns badgeHolder for both current (previous month's winner)
  // and historical views (that month's winner)
  const badgeHolder = data?.badgeHolder ?? null;
  const badgeHolderAddress = badgeHolder?.address ?? null;

  // Banner info
  const bannerAddress = badgeHolderAddress;
  const bannerName = bannerAddress
    ? nameMap.get(bannerAddress.toLowerCase()) ?? shortenAddress(bannerAddress)
    : null;
  const bannerScore = badgeHolder?.score ?? null;
  const bannerPeriod = badgeHolder?.period ?? null;

  return (
    <div className="space-y-6">
      {/* Indexer of the Month banner */}
      {bannerAddress && bannerPeriod && (
        <div className="relative overflow-hidden rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent p-4 sm:p-5">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-500/20 text-amber-400 shrink-0">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium text-amber-400/80 uppercase tracking-wider">
                Indexer of the Month{bannerPeriod ? ` (for ${formatPeriodFull(bannerPeriod)})` : ''}
              </p>
              <Link
                href={`/indexers/${bannerAddress}`}
                className="text-lg font-semibold text-[var(--text)] hover:text-amber-400 transition-colors"
              >
                {bannerName}
              </Link>
              <p className="text-sm text-[var(--text-muted)] mt-0.5">
                Scored {bannerScore?.toFixed(2)} / 100
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text)]">Indexer Leaderboard</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Community favourites — recognising the indexers who contribute most to The Graph network.
            Scored on subgraph coverage, query serving, trust, and community votes.
            For delegator-focused metrics like APR and effective cut, see the{' '}
            <Link href="/indexers" className="text-[var(--accent)] hover:underline">Indexer Directory</Link> scores.
          </p>
        </div>
        {periodsData && periodsData.periods.length > 1 && (
          <select
            value={selectedPeriod ?? ''}
            onChange={(e) => {
              setSelectedPeriod(e.target.value || undefined);
              setPage(0);
            }}
            className={cn(
              'px-3 pr-7 py-2 text-sm rounded-[var(--radius-button)] shrink-0',
              'bg-[var(--bg-surface)] border border-[var(--border)]',
              'text-[var(--text)]',
              'focus:outline-none focus:border-[var(--accent)]'
            )}
          >
            {periodsData.periods.map((p, i) => {
              const ym = periodToYYYYMM(p.start);
              return (
                <option key={ym} value={i === 0 ? '' : ym}>
                  {formatPeriod(p.start)}
                </option>
              );
            })}
          </select>
        )}
      </div>

      {/* Overview stats */}
      <StatGrid>
        <StatCard label="Indexers Ranked" value={String(entries.length)} />
        <StatCard
          label="Top Score"
          value={topScore.toFixed(2)}
          delta={{ value: `/ 100`, positive: topScore >= 70 }}
        />
        <StatCard label="Median Score" value={medianScore.toFixed(2)} />
      </StatGrid>

      {/* Mobile cards */}
      <div className="block md:hidden space-y-3">
        {paginatedEntries.map((entry) => {
          const highlighted = !!highlightAddress && entry.indexer_address.toLowerCase() === highlightAddress.toLowerCase();
          return (
            <div key={entry.indexer_address} data-highlight-row={highlighted ? '' : undefined}>
              <MobileCard
                entry={entry}
                name={nameMap.get(entry.indexer_address.toLowerCase())}
                isBadgeHolder={entry.indexer_address.toLowerCase() === badgeHolderAddress?.toLowerCase()}
                badgePeriod={bannerPeriod}
                votePeriod={votePeriod}
                expanded={expanded === entry.indexer_address}
                onToggle={() => setExpanded(expanded === entry.indexer_address ? null : entry.indexer_address)}
                isHighlighted={highlighted}
              />
            </div>
          );
        })}
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
                <th className={`${TH_CLASS_CENTER} w-12`}>Rank</th>
                <th className={TH_CLASS_LEFT}>Indexer</th>
                <th className={`${TH_CLASS_CENTER} w-20`}>Vote</th>
                <th className={`${TH_CLASS} w-16`}>Score</th>
                <th className={`${TH_CLASS} w-28 hidden lg:table-cell`}>Network</th>
                <th className={`${TH_CLASS} w-24 hidden lg:table-cell`}>Economics</th>
                <th className={`${TH_CLASS} w-24 hidden lg:table-cell`}>Trust</th>
                <th className={`${TH_CLASS} w-24 hidden lg:table-cell`}>Health</th>
                <th className={`${TH_CLASS} w-24 hidden lg:table-cell`}>Community</th>
              </tr>
            </thead>
            <tbody>
              {paginatedEntries.map((entry) => (
                <DesktopRow
                  key={entry.indexer_address}
                  entry={entry}
                  name={nameMap.get(entry.indexer_address.toLowerCase())}
                  isBadgeHolder={entry.indexer_address.toLowerCase() === badgeHolderAddress?.toLowerCase()}
                  badgePeriod={bannerPeriod}
                  votePeriod={votePeriod}
                  expanded={expanded === entry.indexer_address}
                  onToggle={() => setExpanded(expanded === entry.indexer_address ? null : entry.indexer_address)}
                  isHighlighted={!!highlightAddress && entry.indexer_address.toLowerCase() === highlightAddress.toLowerCase()}
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
              The community leaderboard celebrates the indexers who contribute most to The Graph
              network — not just the most profitable ones. Scores are computed monthly using
              percentile normalisation (p10/p90) across all active indexers, grouped into 5 components:
              Network Service (40pts — subgraph coverage, query fees, allocation efficiency),
              Community Votes (10pts — anyone with a wallet can vote once per month; delegator votes count 5x),
              Trust &amp; Stability (20pts — cut stability, tenure, delegation retention),
              Protocol Health (6pts — REO eligibility), and
              Economics (5pts — delegation capacity headroom).
              Indexers who serve more subgraphs score higher than those who concentrate on a few
              profitable deployments. For delegator-focused metrics like APR, effective cut, and
              performance scoring, see the{' '}
              <Link href="/indexers" className="text-[var(--accent)] hover:underline">Indexer Directory</Link>.
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

const TH_BASE =
  'px-4 py-3 text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-[0.06em] select-none border-r border-[var(--border)]/20 last:border-r-0';

const TH_CLASS = `${TH_BASE} text-right`;
const TH_CLASS_LEFT = `${TH_BASE} text-left`;
const TH_CLASS_CENTER = `${TH_BASE} text-center`;

const TD_BORDER = 'border-r border-[var(--border)]/20 last:border-r-0';

// ── Copy link button ──────────────────────────────────────

function CopyLinkButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      title="Copy shareable link"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(`${window.location.origin}/leaderboard?highlight=${address}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="opacity-0 group-hover/row:opacity-100 transition-opacity p-1 rounded text-[var(--text-faint)] hover:text-[var(--accent)]"
    >
      {copied ? (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path strokeLinecap="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      )}
    </button>
  );
}

// ── Desktop row ───────────────────────────────────────────

function DesktopRow({
  entry,
  name,
  isBadgeHolder,
  badgePeriod,
  votePeriod,
  expanded,
  onToggle,
  isHighlighted,
}: {
  entry: LeaderboardEntry;
  name: string | undefined;
  isBadgeHolder?: boolean;
  badgePeriod?: string | null;
  votePeriod: string;
  expanded: boolean;
  onToggle: () => void;
  isHighlighted?: boolean;
}) {
  const networkScore = entry.allocation_breadth_score + entry.query_fee_score + entry.allocation_efficiency_score;
  const economicsScore = entry.capacity_score;
  const trustScore = entry.cut_stability_score + entry.tenure_bonus + entry.retention_score;
  const healthScore = entry.reo_score;

  return (
    <>
      <tr
        data-highlight-row={isHighlighted ? '' : undefined}
        className={cn(
          'group/row border-b border-[0.5px] border-[var(--border)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer',
          isHighlighted && 'ring-1 ring-inset ring-[var(--accent)] bg-[var(--accent-dim)]',
        )}
        onClick={onToggle}
      >
        <td className={`px-4 py-3 text-center ${TD_BORDER}`}>
          <div className="flex items-center justify-center gap-2.5">
            <svg
              className={cn('w-3 h-3 text-[var(--text-faint)] transition-transform', expanded && 'rotate-90')}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <RankBadge rank={entry.rank ?? 0} isBadgeWinner={isBadgeHolder} />
          </div>
        </td>
        <td className={`px-4 py-3 ${TD_BORDER}`}>
          <div className="flex items-center gap-2">
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
            {isBadgeHolder && (
              <span className="relative group inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/15 text-amber-400">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-[10px] font-medium text-white bg-[var(--bg-elevated)] border border-[var(--border-mid)] rounded-md whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity">
                  Indexer of the Month{badgePeriod ? ` (${formatPeriodFull(badgePeriod)})` : ''}
                </span>
              </span>
            )}
            <CopyLinkButton address={entry.indexer_address} />
          </div>
        </td>
        <td className={`px-4 py-3 text-center ${TD_BORDER}`}>
          <VoteButton indexerAddress={entry.indexer_address} period={votePeriod} />
        </td>
        <td className={`px-4 py-3 text-right ${TD_BORDER}`}>
          <span className="font-mono text-sm font-semibold" style={{ color: scoreColor(entry.final_score) }}>
            {entry.final_score.toFixed(2)}
          </span>
        </td>
        <td className={`px-4 py-3 text-right hidden lg:table-cell ${TD_BORDER}`}>
          <ComponentCell score={networkScore} max={40} />
        </td>
        <td className={`px-4 py-3 text-right hidden lg:table-cell ${TD_BORDER}`}>
          <ComponentCell score={economicsScore} max={5} />
        </td>
        <td className={`px-4 py-3 text-right hidden lg:table-cell ${TD_BORDER}`}>
          <ComponentCell score={trustScore} max={20} />
        </td>
        <td className={`px-4 py-3 text-right hidden lg:table-cell ${TD_BORDER}`}>
          <ComponentCell score={healthScore} max={6} />
        </td>
        <td className="px-4 py-3 text-right hidden lg:table-cell">
          <VoteCount indexerAddress={entry.indexer_address} period={votePeriod} />
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-[0.5px] border-[var(--border)]">
          <td colSpan={9} className="px-4 py-4 bg-[var(--bg-elevated)]">
            <ScoreBreakdown entry={entry} votePeriod={votePeriod} />
            <VoterListSection indexerAddress={entry.indexer_address} period={votePeriod} />
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
  isBadgeHolder,
  badgePeriod,
  votePeriod,
  expanded,
  onToggle,
  isHighlighted,
}: {
  entry: LeaderboardEntry;
  name: string | undefined;
  isBadgeHolder?: boolean;
  badgePeriod?: string | null;
  votePeriod: string;
  expanded: boolean;
  onToggle: () => void;
  isHighlighted?: boolean;
}) {
  return (
    <Card
      className={cn('cursor-pointer', isHighlighted && 'ring-1 ring-[var(--accent)] bg-[var(--accent-dim)]')}
      onClick={onToggle}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg
            className={cn('w-3 h-3 text-[var(--text-faint)] transition-transform shrink-0', expanded && 'rotate-90')}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <RankBadge rank={entry.rank ?? 0} isBadgeWinner={isBadgeHolder} />
          <div>
            <div className="flex items-center gap-2">
              <Link
                href={`/indexers/${entry.indexer_address}`}
                className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent)]"
                onClick={(e) => e.stopPropagation()}
              >
                {name ?? shortenAddress(entry.indexer_address)}
              </Link>
              {isBadgeHolder && (
                <span className="relative group inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/15 text-amber-400">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-[10px] font-medium text-white bg-[var(--bg-elevated)] border border-[var(--border-mid)] rounded-md whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity">
                    Indexer of the Month{badgePeriod ? ` (${formatPeriodFull(badgePeriod)})` : ''}
                  </span>
                </span>
              )}
              <CopyLinkButton address={entry.indexer_address} />
            </div>
            {name && (
              <p className="text-xs text-[var(--text-faint)] font-mono">
                {shortenAddress(entry.indexer_address)}
              </p>
            )}
          </div>
        </div>
        <div className="text-right">
          <span className="font-mono text-lg font-bold" style={{ color: scoreColor(entry.final_score) }}>
            {entry.final_score.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Mini bar breakdown */}
      <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-[var(--bg)]">
        <div
          className="rounded-l-full bg-[var(--accent)]"
          style={{ width: barWidth(entry.allocation_breadth_score + entry.query_fee_score + entry.allocation_efficiency_score, 96) }}
          title="Network"
        />
        <div
          className="bg-[var(--green)]"
          style={{ width: barWidth(entry.capacity_score, 96) }}
          title="Economics"
        />
        <div
          className="bg-[var(--cyan)]"
          style={{ width: barWidth(entry.cut_stability_score + entry.tenure_bonus + entry.retention_score, 96) }}
          title="Trust"
        />
        <div
          className="bg-[var(--amber)]"
          style={{ width: barWidth(entry.reo_score, 96) }}
          title="Health"
        />
        <div
          className="rounded-r-full bg-[var(--purple)]"
          style={{ width: barWidth(entry.community_vote_score, 96) }}
          title="Community"
        />
      </div>
      <div className="flex justify-between mt-1.5 text-[10px] text-[var(--text-faint)]">
        <span>Network</span>
        <span>Economics</span>
        <span>Trust</span>
        <span>Health</span>
        <span>Community</span>
      </div>

      {/* Vote button */}
      <div className="mt-3">
        <VoteButton indexerAddress={entry.indexer_address} period={votePeriod} />
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-[var(--border)]">
          <ScoreBreakdown entry={entry} votePeriod={votePeriod} />
          <div className="mt-4 pt-3 border-t border-[var(--border)]">
            <VoterList indexerAddress={entry.indexer_address} period={votePeriod} />
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Voter list wrapper (hides border when no voters) ──────

function VoterListSection({ indexerAddress, period }: { indexerAddress: string; period: string }) {
  const { data: votes } = useVotes(period);
  const hasVoters = (votes?.voters ?? []).some(
    (v) => v.indexer_address.toLowerCase() === indexerAddress.toLowerCase()
  );
  if (!hasVoters) return null;
  return (
    <div className="mt-4 pt-3 border-t border-[var(--border)]">
      <VoterList indexerAddress={indexerAddress} period={period} />
    </div>
  );
}

// ── Score breakdown (shared between mobile/desktop) ───────

function ScoreBreakdown({ entry, votePeriod }: { entry: LeaderboardEntry; votePeriod: string }) {
  const isCurrentPeriod = votePeriod === getCurrentPeriod();
  const { data: votes } = useVotes(votePeriod);
  const liveCommunityScore = useMemo(() => {
    // For historical periods, use the stored score as-is
    if (!isCurrentPeriod) return entry.community_vote_score;
    const tallies = votes?.tallies as VoteTallies | undefined;
    if (!tallies?.length) return entry.community_vote_score;
    const maxWeighted = Math.max(...tallies.map((t) => t.weighted_votes));
    if (maxWeighted === 0) return entry.community_vote_score;
    const tally = tallies.find(
      (t) => t.indexer_address.toLowerCase() === entry.indexer_address.toLowerCase()
    );
    return ((tally?.weighted_votes ?? 0) / maxWeighted) * 10;
  }, [votes, entry.indexer_address, entry.community_vote_score, isCurrentPeriod]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {SCORE_SECTIONS.map((section) => {
        const sectionTotal = section.items.reduce((sum, item) => {
          const val = item.key === 'community_vote_score' ? liveCommunityScore : entry[item.key];
          return sum + val;
        }, 0);
        return (
          <div key={section.label}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-[var(--text)]">{section.label}</span>
              <span className="text-xs font-mono text-[var(--text-muted)]">
                {sectionTotal.toFixed(2)} / {section.max}
              </span>
            </div>
            <div className="space-y-1.5">
              {section.items.map((item) => {
                const value = item.key === 'community_vote_score' ? liveCommunityScore : entry[item.key];
                const pct = item.max > 0 ? (value / item.max) * 100 : 0;
                return (
                  <div key={item.key}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[var(--text-faint)]">{item.label}</span>
                      <span className="font-mono text-[var(--text-muted)]">
                        {value.toFixed(2)} / {item.max}
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

function RankBadge({ rank, isBadgeWinner }: { rank: number; isBadgeWinner?: boolean }) {
  if (rank === 1) {
    return (
      <span className="relative inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold font-mono">
        {isBadgeWinner ? (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        ) : '1'}
        {isBadgeWinner && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 border border-[var(--bg-surface)]" />
        )}
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
        {score.toFixed(2)}
      </span>
    </div>
  );
}
