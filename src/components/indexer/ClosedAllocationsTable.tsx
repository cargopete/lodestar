'use client';

import Link from 'next/link';
import { formatGRT, weiToGRT, shortenAddress, formatRelativeTime } from '@/lib/utils';

export interface ClosedAllocation {
  id: string;
  allocatedTokens: string;
  createdAtEpoch: number;
  closedAtEpoch: number | null;
  closedAt: number | null;
  indexingRewards: string;
  queryFeesCollected: string;
  poi: string | null;
  forceClosed: boolean;
  subgraphDeployment: {
    id: string;
    ipfsHash: string;
    versions: Array<{ subgraph: { metadata: { displayName: string } | null } | null }>;
  };
}

/**
 * Presentational table of an indexer's most recent closed allocations,
 * showing earned rewards/fees and how long each allocation was open.
 */
export function ClosedAllocationsTable({ allocations }: { allocations: ClosedAllocation[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Deployment</th>
            <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Allocated</th>
            <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)] hidden sm:table-cell">Indexing Rewards</th>
            <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)] hidden md:table-cell">Query Fees</th>
            <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)] hidden lg:table-cell">Duration</th>
            <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Closed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {allocations.map((alloc) => {
            const displayName = alloc.subgraphDeployment.versions?.[0]?.subgraph?.metadata?.displayName ?? null;
            const ipfsHash = alloc.subgraphDeployment.ipfsHash ?? '';
            const rewards = weiToGRT(alloc.indexingRewards);
            const fees = weiToGRT(alloc.queryFeesCollected);
            const durationEpochs = alloc.closedAtEpoch != null ? alloc.closedAtEpoch - alloc.createdAtEpoch : null;
            return (
              <tr key={alloc.id} className="hover:bg-[var(--bg-elevated)]">
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <Link
                      href={ipfsHash ? `/subgraphs/${ipfsHash}` : '#'}
                      className="text-sm text-[var(--text)] hover:text-[var(--accent)] transition-colors truncate max-w-[200px]"
                    >
                      {displayName ?? shortenAddress(alloc.subgraphDeployment.id)}
                    </Link>
                    <span className="text-[10px] font-mono text-[var(--text-faint)]">
                      {ipfsHash ? `${ipfsHash.slice(0, 8)}...${ipfsHash.slice(-6)}` : shortenAddress(alloc.subgraphDeployment.id)}
                    </span>
                    {alloc.forceClosed && (
                      <span className="text-[10px] text-[var(--amber)]" title="Closed by another party (e.g. on subgraph deprecation)">
                        force closed
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-sm text-[var(--text)]">{formatGRT(weiToGRT(alloc.allocatedTokens))}</span>
                </td>
                <td className="px-4 py-3 text-right hidden sm:table-cell">
                  <span className="font-mono text-sm text-[var(--green)]">{rewards > 0 ? formatGRT(rewards) : '—'}</span>
                </td>
                <td className="px-4 py-3 text-right hidden md:table-cell">
                  <span className="font-mono text-sm text-[var(--text)]">{fees > 0 ? formatGRT(fees) : '—'}</span>
                </td>
                <td className="px-4 py-3 text-right hidden lg:table-cell">
                  <span className="font-mono text-sm text-[var(--text-muted)]">
                    {durationEpochs != null ? `${durationEpochs} ep` : '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-sm text-[var(--text-muted)]">
                    {alloc.closedAt != null ? formatRelativeTime(alloc.closedAt) : '—'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
