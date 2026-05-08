'use client';

import { use } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { getProtocol, type ProtocolCategory, type ProtocolConfig } from '@/lib/protocols/config';
import type { PredictionMarketsDetail, ProtocolSummary } from '@/lib/protocols/fetcher';
import { useProtocolDetail } from '@/hooks/useProtocols';
import { formatUSD } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { ChartSkeleton } from '@/components/ui/ChartSkeleton';
import { ProtocolLogo, buildProtocolSources } from '@/components/ProtocolLogo';

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-mid)',
    borderRadius: 'var(--radius-button)',
    color: 'var(--text)',
    fontSize: 12,
  },
  labelStyle: { color: 'var(--text)' },
  itemStyle: { color: 'var(--text-muted)' },
};

function formatDate(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function formatPercent(n: number) {
  return `${n.toFixed(2)}%`;
}

function formatCount(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

function formatRelativeTime(unixSeconds: number) {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="p-4 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
      <p className="text-[11px] text-[var(--text-faint)] mb-1">{label}</p>
      <p className="text-xl font-mono font-semibold text-[var(--accent)]">{value}</p>
      {sub && <p className="text-[10px] text-[var(--text-faint)] mt-0.5">{sub}</p>}
    </div>
  );
}

interface CategoryLabels {
  tvlLabel: string;
  volumeLabel: string;
  volumeChartTitle: string;
  volumeTooltipLabel: string;
  feesLabel: string;
  cumulativeLabel: string;
  cumulativeValue: (s?: ProtocolSummary) => number;
  cumulativeSub: string;
}

const CATEGORY_LABELS: Record<ProtocolCategory, CategoryLabels> = {
  'DEX': {
    tvlLabel: 'Total Value Locked',
    volumeLabel: '30d Volume',
    volumeChartTitle: 'Daily Volume (90 days)',
    volumeTooltipLabel: 'Volume',
    feesLabel: '30d Fees',
    cumulativeLabel: 'Total Volume',
    cumulativeValue: (s) => s?.cumulativeVolumeUSD ?? 0,
    cumulativeSub: 'all time',
  },
  'Lending': {
    tvlLabel: 'Total Value Locked',
    volumeLabel: 'Active Borrows',
    volumeChartTitle: 'Daily Borrowing (90 days)',
    volumeTooltipLabel: 'Borrowed',
    feesLabel: '30d Fees',
    cumulativeLabel: 'Total Borrowed',
    cumulativeValue: (s) => s?.cumulativeVolumeUSD ?? 0,
    cumulativeSub: 'all time',
  },
  'Liquid Staking': {
    tvlLabel: 'Total Value Staked',
    volumeLabel: '30d Staker Yield',
    volumeChartTitle: 'Daily Yield to Stakers (90 days)',
    volumeTooltipLabel: 'Yield',
    feesLabel: '30d Protocol Fees',
    cumulativeLabel: 'Cumulative Yield',
    cumulativeValue: (s) => s?.cumulativeVolumeUSD ?? 0,
    cumulativeSub: 'all time',
  },
  'Yield Aggregator': {
    tvlLabel: 'Total Value Locked',
    volumeLabel: '30d Yield to Depositors',
    volumeChartTitle: 'Daily Yield (90 days)',
    volumeTooltipLabel: 'Yield',
    feesLabel: '30d Protocol Fees',
    cumulativeLabel: 'Cumulative Yield',
    cumulativeValue: (s) => s?.cumulativeVolumeUSD ?? 0,
    cumulativeSub: 'all time',
  },
  'Prediction Markets': {
    tvlLabel: 'Open Interest',
    volumeLabel: '30d Volume',
    volumeChartTitle: 'Daily Volume (90 days)',
    volumeTooltipLabel: 'Volume',
    feesLabel: '30d Fees',
    cumulativeLabel: 'Lifetime Volume',
    cumulativeValue: (s) => s?.cumulativeVolumeUSD ?? 0,
    cumulativeSub: 'all time',
  },
  'Bridge': {
    tvlLabel: 'Total Value Locked',
    volumeLabel: '30d Bridged Out',
    volumeChartTitle: 'Daily Bridge Volume (90 days)',
    volumeTooltipLabel: 'Bridged Out',
    feesLabel: '30d Fees',
    cumulativeLabel: 'Cumulative Volume',
    cumulativeValue: (s) => s?.cumulativeVolumeUSD ?? 0,
    cumulativeSub: 'all time',
  },
  // RWA protocols (uncollateralised real-world credit pools) accrue interest
  // continuously on outstanding principal but originate new loans only in
  // discrete institutional drawdowns. The volume series therefore tracks
  // daily interest earned rather than new borrow volume, which gives a
  // meaningful daily picture for harvest-mode protocols. Drawn-balance,
  // pool count, borrower count, and defaults are surfaced via getExtraStats.
  'RWA': {
    tvlLabel: 'Total Lent',
    volumeLabel: '30d Interest',
    volumeChartTitle: 'Daily Interest Earned (90 days)',
    volumeTooltipLabel: 'Interest',
    feesLabel: '30d Interest',
    cumulativeLabel: 'Lifetime Interest',
    cumulativeValue: (s) => s?.cumulativeVolumeUSD ?? 0,
    cumulativeSub: 'paid to LPs + protocol',
  },
  // Perpetuals venues' "TVL" is LP capital backing the venue, not user
  // deposits. Headline activity is trade volume; the dominant state metric
  // is open interest (notional value of all currently-open positions),
  // surfaced as a separate hero stat via getExtraStats.
  'Perpetuals': {
    tvlLabel: 'LP Capital',
    volumeLabel: '30d Trading Volume',
    volumeChartTitle: 'Daily Trading Volume (90 days)',
    volumeTooltipLabel: 'Volume',
    feesLabel: '30d Fees',
    cumulativeLabel: 'Lifetime Volume',
    cumulativeValue: (s) => s?.cumulativeVolumeUSD ?? 0,
    cumulativeSub: 'all time',
  },
};

interface ExtraStat {
  label: string;
  value: string;
}

function getExtraStats(category: ProtocolCategory, summary?: ProtocolSummary): ExtraStat[] {
  if (!summary) return [];
  if (category === 'Liquid Staking' && summary.stakingAPR) {
    return [{ label: 'Staking APR (30d est.)', value: formatPercent(summary.stakingAPR) }];
  }
  if (category === 'Yield Aggregator' && summary.stakingAPR) {
    return [{ label: 'Net APY (30d est.)', value: formatPercent(summary.stakingAPR) }];
  }
  if (category === 'RWA') {
    const stats: ExtraStat[] = [];
    if (typeof summary.rwaDrawnBalanceUSD === 'number') {
      stats.push({ label: 'Drawn Balance', value: formatUSD(summary.rwaDrawnBalanceUSD) });
    }
    if (typeof summary.rwaPoolCount === 'number' && summary.rwaPoolCount > 0) {
      stats.push({ label: 'Active Pools', value: summary.rwaPoolCount.toLocaleString() });
    }
    if (typeof summary.rwaUniqueBorrowers === 'number' && summary.rwaUniqueBorrowers > 0) {
      stats.push({ label: 'Unique Borrowers', value: summary.rwaUniqueBorrowers.toLocaleString() });
    }
    if (typeof summary.rwaDefaultsUSD === 'number') {
      stats.push({
        label: 'Defaults',
        value: summary.rwaDefaultsUSD === 0 ? 'None' : formatUSD(summary.rwaDefaultsUSD),
      });
    }
    return stats;
  }
  if (category === 'Perpetuals') {
    const stats: ExtraStat[] = [];
    if (typeof summary.perpOpenInterestUSD === 'number' && summary.perpOpenInterestUSD > 0) {
      stats.push({ label: 'Open Interest', value: formatUSD(summary.perpOpenInterestUSD) });
    }
    if (typeof summary.perpLongOpenInterestUSD === 'number' && summary.perpLongOpenInterestUSD > 0) {
      stats.push({ label: 'Long OI', value: formatUSD(summary.perpLongOpenInterestUSD) });
    }
    if (typeof summary.perpShortOpenInterestUSD === 'number' && summary.perpShortOpenInterestUSD > 0) {
      stats.push({ label: 'Short OI', value: formatUSD(summary.perpShortOpenInterestUSD) });
    }
    return stats;
  }
  return [];
}

function ProtocolHeader({ config }: { config: ProtocolConfig }) {
  return (
    <div className="pb-2 border-b border-[var(--border)]">
      <div className="flex items-center gap-2 text-xs text-[var(--text-faint)] mb-2">
        <Link href="/protocols" className="hover:text-[var(--accent)] transition-colors">Protocols</Link>
        <span>/</span>
        <span>{config.name}</span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <ProtocolLogo
            name={config.name}
            color={config.color}
            sources={buildProtocolSources(config.family ?? config.slug)}
            size={36}
          />
          <div>
            <h1 className="text-2xl font-semibold text-[var(--text)]">{config.name}</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5 max-w-2xl">{config.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-[var(--text-faint)] bg-[var(--bg-elevated)] border border-[var(--border)] px-2 py-1 rounded-[var(--radius-button)]">
            {config.chains.join(' · ')}
          </span>
          <a
            href={config.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--accent)] hover:underline"
          >
            {config.website.replace('https://', '')} ↗
          </a>
        </div>
      </div>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: PredictionMarketsDetail['recentResolutions'][number]['outcome'] }) {
  const styles: Record<typeof outcome, string> = {
    YES: 'bg-[var(--green)]/15 text-[var(--green)] border-[var(--green)]/30',
    NO: 'bg-[#FF5C5C]/15 text-[#FF8585] border-[#FF5C5C]/30',
    PARTIAL: 'bg-[var(--yellow,#f59e0b)]/15 text-[var(--yellow,#f59e0b)] border-[var(--yellow,#f59e0b)]/30',
    UNRESOLVED: 'bg-[var(--bg-elevated)] text-[var(--text-faint)] border-[var(--border)]',
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${styles[outcome]}`}>
      {outcome}
    </span>
  );
}

function PredictionMarketsView({
  config,
  summary,
  detail,
  isLoading,
}: {
  config: ProtocolConfig;
  summary?: ProtocolSummary;
  detail?: PredictionMarketsDetail;
  isLoading: boolean;
}) {
  const placeholder = isLoading || !detail;
  return (
    <div className="space-y-6">
      <ProtocolHeader config={config} />

      {/* Lifetime KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          label="Lifetime Volume"
          value={isLoading ? '—' : formatUSD(summary?.cumulativeVolumeUSD ?? 0)}
          sub="all time"
        />
        <MetricCard
          label="Lifetime Fees"
          value={isLoading ? '—' : formatUSD(summary?.cumulativeFeesUSD ?? 0)}
          sub="all time"
        />
        <MetricCard
          label="Total Trades"
          value={placeholder ? '—' : formatCount(detail.totalTrades)}
          sub="all time"
        />
        <MetricCard
          label="Avg Trade Size"
          value={placeholder ? '—' : formatUSD(detail.avgTradeSize)}
        />
      </div>

      {/* Ecosystem stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Active Markets', value: placeholder ? '—' : formatCount(detail.activeMarkets) },
          { label: 'Resolved Markets', value: placeholder ? '—' : formatCount(detail.resolvedMarkets) },
          { label: 'Unique Traders', value: placeholder ? '—' : formatCount(detail.totalTraders) },
          { label: 'Disputed Resolutions', value: placeholder ? '—' : formatCount(detail.disputedCount), sub: detail && detail.disputedCount >= 250 ? '250+ tracked' : undefined },
        ].map((s) => (
          <div key={s.label} className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)]/60 border border-[var(--border)]">
            <p className="text-[10px] text-[var(--text-faint)] mb-0.5">{s.label}</p>
            <p className="text-sm font-mono font-medium text-[var(--text)]">{s.value}</p>
            {s.sub && <p className="text-[9px] text-[var(--text-faint)] mt-0.5">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Recent Resolutions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Resolutions</CardTitle>
        </CardHeader>
        <CardContent>
          {placeholder ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-9 shimmer rounded" />
              ))}
            </div>
          ) : detail.recentResolutions.length === 0 ? (
            <p className="text-xs text-[var(--text-faint)]">No recent resolutions returned.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)]">Market</th>
                    <th className="text-left py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)] w-20">Outcome</th>
                    <th className="text-left py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)] w-24">Resolved</th>
                    <th className="text-left py-2 text-[11px] font-medium text-[var(--text-faint)] w-20">Disputed</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recentResolutions.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-elevated)]/40 transition-colors"
                    >
                      <td className="py-2.5 pr-4 text-[var(--text)] max-w-md">
                        <span className="line-clamp-2 leading-snug">{r.title || r.id.slice(0, 12) + '…'}</span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <OutcomeBadge outcome={r.outcome} />
                      </td>
                      <td className="py-2.5 pr-4 text-[var(--text-muted)] font-mono text-xs whitespace-nowrap">
                        {formatRelativeTime(r.resolvedAt)}
                      </td>
                      <td className="py-2.5 text-xs">
                        {r.wasDisputed ? (
                          <span className="text-[var(--yellow,#f59e0b)] font-medium">disputed</span>
                        ) : (
                          <span className="text-[var(--text-faint)]">no</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top Markets by Open Interest */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Top Markets by Open Interest</CardTitle>
            <span className="text-[10px] text-[var(--text-faint)]">includes residual OI from resolved markets</span>
          </div>
        </CardHeader>
        <CardContent>
          {placeholder ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-9 shimmer rounded" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)] w-8">#</th>
                    <th className="text-left py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)]">Market</th>
                    <th className="text-right py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)]">OI</th>
                    <th className="text-right py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)]">Splits</th>
                    <th className="text-right py-2 text-[11px] font-medium text-[var(--text-faint)]">Merges</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.topMarketsByOI.map((m, i) => {
                    const idShort = `${m.id.slice(0, 10)}…${m.id.slice(-6)}`;
                    const titleNode = m.title ? (
                      m.slug ? (
                        <a
                          href={`https://polymarket.com/event/${m.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--text)] hover:text-[var(--accent)] transition-colors line-clamp-2 leading-snug"
                        >
                          {m.title}
                        </a>
                      ) : (
                        <span className="text-[var(--text)] line-clamp-2 leading-snug">{m.title}</span>
                      )
                    ) : (
                      <span className="text-[var(--text-muted)] font-mono text-xs">{idShort}</span>
                    );
                    return (
                      <tr
                        key={m.id}
                        className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-elevated)]/40 transition-colors"
                      >
                        <td className="py-2.5 pr-4 text-[var(--text-faint)] font-mono text-xs align-top">{i + 1}</td>
                        <td className="py-2.5 pr-4 max-w-md align-top">
                          {titleNode}
                          {m.title && (
                            <div className="text-[10px] text-[var(--text-faint)] font-mono mt-0.5">{idShort}</div>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono text-[var(--text)] whitespace-nowrap align-top">{formatUSD(m.amountUSD)}</td>
                        <td className="py-2.5 pr-4 text-right font-mono text-[var(--text-muted)] text-xs whitespace-nowrap align-top">{formatCount(m.splitCount)}</td>
                        <td className="py-2.5 text-right font-mono text-[var(--text-muted)] text-xs whitespace-nowrap align-top">{formatCount(m.mergeCount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footnote on data shape */}
      {config.knownIssues && (
        <p className="text-[10px] text-[var(--text-faint)] leading-relaxed max-w-3xl">
          <span className="font-medium text-[var(--text-muted)]">Note: </span>
          {config.knownIssues}
        </p>
      )}
    </div>
  );
}

export default function ProtocolDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const config = getProtocol(slug);

  if (!config) notFound();

  const { data, isLoading } = useProtocolDetail(slug);
  const { summary, snapshots = [], predictionMarkets } = data ?? {};

  // Prediction Markets get a domain-tailored layout (lifetime KPIs, ecosystem
  // stats, recent resolutions, top markets by OI) instead of the standard
  // TVL/Volume/Fees + 90d-snapshot pattern that doesn't fit the asset class.
  if (config.category === 'Prediction Markets') {
    return (
      <PredictionMarketsView
        config={config}
        summary={summary}
        detail={predictionMarkets}
        isLoading={isLoading}
      />
    );
  }

  const chartData = snapshots.map((s) => ({
    date: formatDate(s.timestamp),
    tvl: s.tvlUSD,
    volume: s.volumeUSD,
    fees: s.feesUSD,
  }));

  const labels = CATEGORY_LABELS[config.category];
  const extras = getExtraStats(config.category, summary);
  // Some protocols don't expose a daily aggregate entity in their subgraphs
  // (e.g. Polymarket's orderbook). When that's the case, normalize() returns
  // an empty snapshots array and the TVL/Volume charts have nothing to draw.
  const hasDailySeries = !isLoading && chartData.length > 0;
  // Route the knownIssues notice to the chart it actually affects. Defaults to
  // 'fees' to preserve existing behavior for Morpho Blue.
  const issueAffects = config.knownIssueAffects ?? 'fees';
  const volumeIssue = config.knownIssues && issueAffects === 'volume' ? config.knownIssues : null;
  const feesIssue = config.knownIssues && issueAffects === 'fees' ? config.knownIssues : null;

  // Lending uses Active Borrows (current snapshot) instead of summed 30d volume
  const volumeKpiValue = config.category === 'Lending'
    ? summary?.totalBorrowUSD ?? 0
    : summary?.volume30dUSD ?? 0;
  const volumeKpiSub = config.category === 'Lending' ? undefined : 'last 30 days';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-2 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 text-xs text-[var(--text-faint)] mb-2">
          <Link href="/protocols" className="hover:text-[var(--accent)] transition-colors">Protocols</Link>
          <span>/</span>
          <span>{config.name}</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <ProtocolLogo
            name={config.name}
            color={config.color}
            sources={buildProtocolSources(config.family ?? config.slug)}
            size={36}
          />
            <div>
              <h1 className="text-2xl font-semibold text-[var(--text)]">{config.name}</h1>
              <p className="text-sm text-[var(--text-muted)] mt-0.5 max-w-2xl">{config.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-[var(--text-faint)] bg-[var(--bg-elevated)] border border-[var(--border)] px-2 py-1 rounded-[var(--radius-button)]">
              {config.chains.join(' · ')}
            </span>
            <a
              href={config.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--accent)] hover:underline"
            >
              {config.website.replace('https://', '')} ↗
            </a>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          label={labels.tvlLabel}
          value={isLoading ? '—' : formatUSD(summary?.tvlUSD ?? 0)}
        />
        <MetricCard
          label={labels.volumeLabel}
          value={isLoading ? '—' : formatUSD(volumeKpiValue)}
          sub={volumeKpiSub}
        />
        <MetricCard
          label={labels.feesLabel}
          value={isLoading ? '—' : formatUSD(summary?.fees30dUSD ?? 0)}
          sub="last 30 days"
        />
        <MetricCard
          label={labels.cumulativeLabel}
          value={isLoading ? '—' : formatUSD(labels.cumulativeValue(summary))}
          sub={labels.cumulativeSub}
        />
      </div>

      {/* Category-specific extras */}
      {extras.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {extras.map((stat) => (
            <div
              key={stat.label}
              className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)]/60 border border-[var(--border)]"
            >
              <p className="text-[10px] text-[var(--text-faint)] mb-0.5">{stat.label}</p>
              <p className="text-sm font-mono font-medium text-[var(--text)]">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* TVL chart */}
      <Card>
        <CardHeader>
          <CardTitle>{labels.tvlLabel} (90 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ChartSkeleton height="220px" />
          ) : !hasDailySeries ? (
            <div className="h-[220px] flex flex-col items-center justify-center gap-2 text-center px-4">
              <p className="text-[11px] font-medium text-[var(--text-muted)]">No daily series available</p>
              <p className="text-[11px] text-[var(--text-faint)] max-w-md">Headline numbers above are computed from cumulative on-chain state. The upstream subgraph does not expose a daily aggregate entity, so a 90-day TVL chart is not available for this protocol.</p>
            </div>
          ) : (
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tvlGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={config.color} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={config.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                    interval={Math.max(0, Math.floor(chartData.length / 6) - 1)}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                    tickFormatter={(v) => formatUSD(v)}
                    width={70}
                  />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(value) => [formatUSD(Number(value)), 'TVL']}
                  />
                  <Area
                    type="monotone"
                    dataKey="tvl"
                    stroke={config.color}
                    strokeWidth={2}
                    fill="url(#tvlGradient)"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Volume + Fees charts side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{labels.volumeChartTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ChartSkeleton height="180px" />
            ) : volumeIssue ? (
              <div className="h-[180px] flex flex-col items-center justify-center gap-2 text-center px-4">
                <p className="text-[11px] font-medium text-[var(--yellow,#f59e0b)]">Upstream data issue</p>
                <p className="text-[11px] text-[var(--text-muted)] max-w-xs">{volumeIssue}</p>
              </div>
            ) : !hasDailySeries ? (
              <div className="h-[180px] flex flex-col items-center justify-center gap-2 text-center px-4">
                <p className="text-[11px] font-medium text-[var(--text-muted)]">No daily series available</p>
                <p className="text-[11px] text-[var(--text-faint)] max-w-xs">{labels.cumulativeLabel} is shown above as a lifetime total.</p>
              </div>
            ) : (
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                      interval={Math.max(0, Math.floor(chartData.length / 5) - 1)}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                      tickFormatter={(v) => formatUSD(v)}
                      width={70}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(value) => [formatUSD(Number(value)), labels.volumeTooltipLabel]}
                    />
                    <Bar dataKey="volume" fill={config.color} fillOpacity={0.7} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Daily Fees (90 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ChartSkeleton height="180px" />
            ) : feesIssue ? (
              <div className="h-[180px] flex flex-col items-center justify-center gap-2 text-center px-4">
                <p className="text-[11px] font-medium text-[var(--yellow,#f59e0b)]">Upstream data issue</p>
                <p className="text-[11px] text-[var(--text-muted)] max-w-xs">{feesIssue}</p>
              </div>
            ) : (
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                      interval={Math.max(0, Math.floor(chartData.length / 5) - 1)}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--text-faint)', fontSize: 10 }}
                      tickFormatter={(v) => formatUSD(v)}
                      width={70}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(value) => [formatUSD(Number(value)), 'Fees']}
                    />
                    <Bar dataKey="fees" fill="var(--accent)" fillOpacity={0.7} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Attribution */}
      <div className="flex items-center justify-between text-xs text-[var(--text-faint)]">
        <span>
          Data sourced from{' '}
          <a
            href={`https://thegraph.com/explorer/subgraphs/${config.subgraphId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            The Graph ↗
          </a>
        </span>
        <Link href="/protocols" className="hover:text-[var(--accent)] transition-colors">
          ← All protocols
        </Link>
      </div>
    </div>
  );
}
