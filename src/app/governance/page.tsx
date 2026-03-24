'use client';

import { useEnrichedIndexers, useNetworkStats } from '@/hooks/useNetworkStats';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { weiToGRT, formatGRT, cn } from '@/lib/utils';
import type { EnrichedIndexer } from '@/lib/enriched';

type GIPStatus = 'deployed' | 'approved' | 'candidate' | 'draft';

interface GIP {
  id: string;
  title: string;
  status: GIPStatus;
  authors: string;
  forumUrl: string;
  summary: string;
  indexerImpact: string;
  delegatorImpact: string;
  // Optional: function to compute live metrics from available data
  liveMetrics?: (indexers: EnrichedIndexer[], network: NetworkData | null) => LiveMetric[];
}

interface LiveMetric {
  label: string;
  value: string;
  color?: string;
}

interface NetworkData {
  totalTokensStaked: string;
  totalTokensAllocated: string;
  networkGRTIssuancePerBlock?: string;
  delegationRatio: number;
}

const STATUS_ORDER: Record<GIPStatus, number> = {
  deployed: 0,
  approved: 1,
  candidate: 2,
  draft: 3,
};

const STATUS_VARIANT: Record<GIPStatus, 'success' | 'accent' | 'warning' | 'error'> = {
  deployed: 'success',
  approved: 'accent',
  candidate: 'warning',
  draft: 'error',
};

const GIPS: GIP[] = [
  {
    id: 'GIP-0079',
    title: 'Rewards Eligibility Oracle',
    status: 'approved',
    authors: 'Graph Foundation',
    forumUrl: 'https://forum.thegraph.com/t/gip-0079-indexer-rewards-eligibility-oracle/6734',
    summary: 'Gates indexing rewards on actual service quality — HTTP status, response speed, and data freshness — evaluated over 28-day windows with 14-day renewal cycles. Oracle contract is live on Arbitrum and scoring indexers, but enforcement (reward gating) is pending GIP-0086.',
    indexerImpact: 'Must maintain quality service to retain reward eligibility. Failure to meet thresholds (200 OK, <5s response, <50K blocks behind) will result in lost rewards once enforcement is active.',
    delegatorImpact: 'Once enforced, delegation to ineligible indexers will earn zero rewards. Monitor your indexer\'s REO status now — Lodestar shows oracle-sourced eligibility data and renewal countdowns on every indexer page.',
    liveMetrics: (indexers) => {
      const eligible = indexers.filter(i => i.reoStatus === 'eligible').length;
      const total = indexers.length;
      const oracleSourced = indexers.filter(i => i.reoSource === 'oracle').length;
      const expiringSoon = indexers.filter(i =>
        i.reoStatus === 'eligible' && i.reoDaysRemaining !== null && i.reoDaysRemaining <= 3
      ).length;
      return [
        { label: 'Eligible indexers', value: `${eligible} / ${total}`, color: 'var(--green)' },
        { label: 'Oracle-sourced', value: `${oracleSourced}`, color: 'var(--accent)' },
        { label: 'Expiring <3 days', value: `${expiringSoon}`, color: expiringSoon > 0 ? 'var(--amber)' : 'var(--green)' },
      ];
    },
  },
  {
    id: 'GIP-0086',
    title: 'Rewards Manager & Subgraph Service Upgrade',
    status: 'approved',
    authors: 'Edge & Node',
    forumUrl: 'https://forum.thegraph.com/t/gip-0086-rewards-manager-and-subgraph-service-upgrade/6868',
    summary: 'Upgrades the RewardsManager to integrate with the REO oracle and adds POIPresented events with claim/deny/defer outcomes. Prerequisite for on-chain indexing agreements.',
    indexerImpact: 'RewardsManager now checks REO eligibility at reward claim time. New POIPresented events create richer on-chain data about indexer performance.',
    delegatorImpact: 'Better reward distribution accuracy. POI presentation data will feed into indexer scoring and compliance tracking.',
  },
  {
    id: 'GIP-0087',
    title: 'On-Chain Indexing Agreements',
    status: 'draft',
    authors: 'Rembrandt Kuipers (Edge & Node)',
    forumUrl: 'https://forum.thegraph.com/t/on-chain-indexing-agreements-and-issuance-allocation-gip-0087-gip-0088/6869',
    summary: 'Creates a new marketplace layer for indexing agreements — offers, acceptances, POI presentations, escrow balances, and payment flows. The RecurringAgreementManager receives minted GRT and manages agreement lifecycles.',
    indexerImpact: 'New revenue stream from on-chain agreements alongside existing allocation rewards. Must actively manage agreements, present POIs, and maintain escrow health.',
    delegatorImpact: 'Indexers with active agreements generate additional revenue that flows through to delegators. Agreement participation becomes a key factor in indexer selection.',
  },
  {
    id: 'GIP-0088',
    title: 'Issuance Allocator Deployment',
    status: 'draft',
    authors: 'Edge & Node',
    forumUrl: 'https://forum.thegraph.com/t/on-chain-indexing-agreements-and-issuance-allocation-gip-0087-gip-0088/6869',
    summary: 'Deploys the IssuanceAllocator to split GRT issuance between the RewardsManager and the RecurringAgreementManager. Initial split: ~5% (~6 GRT/block) to agreements, expected to grow to ~10%.',
    indexerImpact: 'Allocation-based rewards decrease by ~5% initially as issuance redirects to agreement funding. Indexers participating in agreements can recapture and exceed this via agreement revenue.',
    delegatorImpact: 'Base APR from allocations decreases slightly (~5%). But total ecosystem rewards increase if indexers actively participate in agreements. Net effect depends on your indexer\'s agreement activity.',
    liveMetrics: (_indexers, network) => {
      if (!network?.networkGRTIssuancePerBlock) return [];
      const issuancePerBlock = weiToGRT(network.networkGRTIssuancePerBlock);
      const annualIssuance = issuancePerBlock * 2_628_000;
      const redirected5pct = annualIssuance * 0.05;
      const redirected10pct = annualIssuance * 0.10;
      return [
        { label: 'Annual issuance', value: `${formatGRT(annualIssuance)} GRT` },
        { label: '5% redirect (initial)', value: `${formatGRT(redirected5pct)} GRT`, color: 'var(--amber)' },
        { label: '10% redirect (target)', value: `${formatGRT(redirected10pct)} GRT`, color: 'var(--amber)' },
      ];
    },
  },
  {
    id: 'GIP-0070',
    title: 'Protocol Economics Evolution',
    status: 'candidate',
    authors: 'Graph Foundation',
    forumUrl: 'https://forum.thegraph.com/t/gip-0070-evolving-the-graph-protocol-economics/6734',
    summary: 'Broader economic restructuring including issuance model updates, fee market evolution, and protocol sustainability mechanisms as The Graph transitions to a multi-service protocol.',
    indexerImpact: 'Long-term economic framework changes affecting reward structures, fee markets, and the balance between issuance-funded and fee-funded revenue.',
    delegatorImpact: 'Economic model changes affect long-term APR sustainability. The shift toward fee-based revenue means delegator returns increasingly depend on actual query volume, not just issuance.',
  },
];

export default function GovernancePage() {
  const { data: enrichedData } = useEnrichedIndexers();
  const { data: networkData } = useNetworkStats();

  const indexers: EnrichedIndexer[] = enrichedData?.indexers ?? [];
  const network: NetworkData | null = networkData?.graphNetwork ?? null;

  const sortedGIPs = [...GIPS].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  // Summary stats
  const deployed = GIPS.filter(g => g.status === 'deployed').length;
  const inProgress = GIPS.filter(g => g.status === 'approved' || g.status === 'candidate').length;
  const drafts = GIPS.filter(g => g.status === 'draft').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-[var(--text)]">Governance Tracker</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Active GIPs affecting protocol economics — what they mean for your APR, your indexer, and your delegation.
        </p>
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-center">
          <p className="text-2xl font-mono font-bold text-[var(--green)]">{deployed}</p>
          <p className="text-xs text-[var(--text-faint)] mt-1">Deployed</p>
        </div>
        <div className="p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-center">
          <p className="text-2xl font-mono font-bold text-[var(--accent)]">{inProgress}</p>
          <p className="text-xs text-[var(--text-faint)] mt-1">In Progress</p>
        </div>
        <div className="p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-center">
          <p className="text-2xl font-mono font-bold text-[var(--text-muted)]">{drafts}</p>
          <p className="text-xs text-[var(--text-faint)] mt-1">Draft</p>
        </div>
      </div>

      {/* GIP cards */}
      <div className="space-y-4">
        {sortedGIPs.map((gip) => {
          const metrics = gip.liveMetrics?.(indexers, network) ?? [];

          return (
            <Card key={gip.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-[var(--text-faint)]">{gip.id}</span>
                      <Badge variant={STATUS_VARIANT[gip.status]}>
                        {gip.status.charAt(0).toUpperCase() + gip.status.slice(1)}
                      </Badge>
                    </div>
                    <CardTitle>{gip.title}</CardTitle>
                    <p className="text-xs text-[var(--text-faint)] mt-1">by {gip.authors}</p>
                  </div>
                  <a
                    href={gip.forumUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--accent)] hover:underline flex-shrink-0 mt-1"
                  >
                    Forum
                  </a>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[var(--text-muted)] mb-4">{gip.summary}</p>

                {/* Live metrics (when available) */}
                {metrics.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                    {metrics.map((m, i) => (
                      <div key={i} className="p-2.5 rounded-lg bg-[var(--bg-elevated)] text-center">
                        <p className="text-xs text-[var(--text-faint)]">{m.label}</p>
                        <p className="text-sm font-mono font-medium mt-0.5" style={m.color ? { color: m.color } : undefined}>
                          {m.value}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Impact cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg border border-[var(--border)]">
                    <div className="flex items-center gap-1.5 mb-2">
                      <svg className="w-3.5 h-3.5 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                      </svg>
                      <span className="text-xs font-semibold text-[var(--text)]">Indexer Impact</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] leading-relaxed">{gip.indexerImpact}</p>
                  </div>
                  <div className="p-3 rounded-lg border border-[var(--border)]">
                    <div className="flex items-center gap-1.5 mb-2">
                      <svg className="w-3.5 h-3.5 text-[var(--green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-xs font-semibold text-[var(--text)]">Delegator Impact</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] leading-relaxed">{gip.delegatorImpact}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Disclaimer */}
      <p className="text-[11px] text-[var(--text-faint)] leading-relaxed text-center px-4">
        Impact summaries are Lodestar&apos;s interpretation of active GIPs. Governance proposals can change during review.
        Live metrics sourced from on-chain data. For authoritative GIP text, see the linked forum discussions.
      </p>
    </div>
  );
}
