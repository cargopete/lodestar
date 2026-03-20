'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePOIOverview } from '@/hooks/useNetworkStats';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { Pagination } from '@/components/ui/Pagination';
import { formatGRT, formatPercent, cn } from '@/lib/utils';
import type { POIDeploymentSummary } from '@/lib/poi';

// ---------- constants ----------

const PAGE_SIZE = 25;

// ---------- component ----------

export default function POIDashboard() {
  const { data: overview, isLoading, isError } = usePOIOverview();
  const [page, setPage] = useState(0);

  const paginatedDeployments = useMemo(() => {
    if (!overview) return [];
    const start = page * PAGE_SIZE;
    return overview.deployments.slice(start, start + PAGE_SIZE);
  }, [overview, page]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !overview) {
    return (
      <div className="text-center py-24">
        <h2 className="text-xl font-semibold text-[var(--text)] mb-2">Unable to Load POI Data</h2>
        <p className="text-[var(--text-muted)]">
          Could not fetch closed allocation data from the network subgraph.
        </p>
      </div>
    );
  }

  const { summary, deployments } = overview;

  const thClass =
    'px-4 py-3 text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-[0.06em] select-none';

  return (
    <div className="space-y-6">
      {/* Overview stats */}
      <StatGrid>
        <StatCard
          label="Allocations Analyzed"
          value={String(summary.totalAllocations)}
          subtitle="Recent closed allocations"
        />
        <StatCard
          label="Deployments Tracked"
          value={String(summary.deploymentsTracked)}
        />
        <StatCard
          label="Consensus Rate"
          value={formatPercent(summary.overallConsensusRate)}
          delta={{
            value: 'stake-weighted',
            positive: summary.overallConsensusRate > 90,
          }}
        />
        <StatCard
          label="Divergent Deployments"
          value={String(summary.divergentDeployments)}
          delta={
            summary.divergentDeployments > 0
              ? { value: 'needs attention', positive: false }
              : { value: 'all clean', positive: true }
          }
        />
      </StatGrid>

      {/* Mobile cards */}
      <div className="block md:hidden space-y-3">
        {paginatedDeployments.map((dep) => (
          <Link key={dep.deploymentId} href={`/poi/${dep.ipfsHash}`}>
            <Card className="hover:border-[var(--accent-hover)] transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <span className="font-mono text-sm text-[var(--text)]" title={dep.ipfsHash}>
                    {dep.ipfsHash.slice(0, 8)}...{dep.ipfsHash.slice(-6)}
                  </span>
                  <p className="text-xs text-[var(--text-faint)] mt-0.5">Epoch {dep.latestEpoch}</p>
                </div>
                <StatusBadge dep={dep} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded bg-[var(--bg-elevated)]">
                  <p className="text-[10px] text-[var(--text-faint)]">Consensus</p>
                  <p className={cn(
                    'text-xs font-mono',
                    dep.consensusPct === 100 ? 'text-[var(--green)]' : 'text-[var(--amber)]'
                  )}>
                    {formatPercent(dep.consensusPct)}
                  </p>
                </div>
                <div className="p-2 rounded bg-[var(--bg-elevated)]">
                  <p className="text-[10px] text-[var(--text-faint)]">Indexers</p>
                  <p className="text-xs font-mono text-[var(--text)]">{dep.uniqueIndexers}</p>
                </div>
                <div className="p-2 rounded bg-[var(--bg-elevated)]">
                  <p className="text-[10px] text-[var(--text-faint)]">Signal</p>
                  <p className="text-xs font-mono text-[var(--text)]">{formatGRT(dep.signal)}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={deployments.length}
          onPageChange={setPage}
        />
      </div>

      {/* Desktop table */}
      <Card className="overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--bg-elevated)]">
              <tr>
                <th className={cn(thClass, 'text-left')}>Deployment</th>
                <th className={cn(thClass, 'text-center')}>Status</th>
                <th className={cn(thClass, 'text-right')}>Epoch</th>
                <th className={cn(thClass, 'text-right')}>Allocations</th>
                <th className={cn(thClass, 'text-right')}>Indexers</th>
                <th className={cn(thClass, 'text-right')}>Consensus</th>
                <th className={cn(thClass, 'text-right')}>Divergent</th>
                <th className={cn(thClass, 'text-right')}>Signal</th>
              </tr>
            </thead>
            <tbody>
              {paginatedDeployments.map((dep) => (
                <tr
                  key={dep.deploymentId}
                  className="border-b border-[0.5px] border-[var(--border)] hover:bg-[var(--bg-elevated)] transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/poi/${dep.ipfsHash}`}
                      className="font-mono text-sm text-[var(--text)] hover:text-[var(--accent)] transition-colors"
                      title={dep.ipfsHash}
                    >
                      {dep.ipfsHash.slice(0, 8)}...{dep.ipfsHash.slice(-6)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge dep={dep} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text-muted)]">
                    {dep.latestEpoch}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text)]">
                    {dep.allocationCount}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text)]">
                    {dep.uniqueIndexers}
                  </td>
                  <td className={cn(
                    'px-4 py-3 text-right font-mono text-sm',
                    dep.consensusPct === 100
                      ? 'text-[var(--green)]'
                      : dep.consensusPct >= 90
                        ? 'text-[var(--amber)]'
                        : 'text-[var(--red)]'
                  )}>
                    {formatPercent(dep.consensusPct)}
                  </td>
                  <td className={cn(
                    'px-4 py-3 text-right font-mono text-sm',
                    dep.divergentCount > 0 ? 'text-[var(--red)] font-semibold' : 'text-[var(--text-faint)]'
                  )}>
                    {dep.divergentCount > 0 ? dep.divergentCount : '--'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text)]">
                    {formatGRT(dep.signal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={deployments.length}
          onPageChange={setPage}
        />
      </Card>

      {/* Info panel */}
      <Card>
        <div className="p-4 space-y-4">
          <div>
            <h4 className="font-semibold text-[var(--text)] mb-2">About POI Consensus</h4>
            <p className="text-sm text-[var(--text-muted)]">
              A Proof of Indexing (POI) is a cryptographic hash of the entity store state at a given block.
              When multiple indexers submit different POIs for the same deployment and epoch, it indicates
              at least one indexer has divergent data — which can lead to disputes and slashing of staked GRT.
              Consensus is stake-weighted: the POI backed by the most allocated tokens is treated as correct.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-[var(--text)] mb-2">Data Source &amp; Limitations</h4>
            <p className="text-sm text-[var(--text-muted)]">
              This dashboard analyses <span className="text-[var(--text)]">on-chain allocation POIs</span> from
              the network subgraph — the POI each indexer submitted when closing an allocation. Tools like
              POIfier and Subgraph Radio compare real-time POIs queried directly from indexer graph-nodes
              via the <span className="font-mono text-xs">proofOfIndexing</span> API, which requires
              self-hosted infrastructure. Lodestar is the only public dashboard for POI consensus, but
              on-chain data is sparser: you only see POIs at allocation close, not at arbitrary blocks.
              Allocations closed with a zero POI (empty close, no proof submitted) are excluded from consensus.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function StatusBadge({ dep }: { dep: POIDeploymentSummary }) {
  if (dep.hasDivergence) {
    return <Badge variant="error">Divergent</Badge>;
  }
  return <Badge variant="success">Consensus</Badge>;
}
