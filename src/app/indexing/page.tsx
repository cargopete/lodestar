'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSubgraphDeployments } from '@/hooks/useNetworkStats';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn, weiToGRT, formatGRT, shortenAddress } from '@/lib/utils';

export default function IndexingStatusPage() {
  const router = useRouter();
  const [hash, setHash] = useState('');
  const { data: deployments, isLoading } = useSubgraphDeployments({
    first: 20,
    orderBy: 'stakedTokens',
    orderDirection: 'desc',
  });

  const handleLookup = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const value = hash.trim();
      if (!value) return;
      router.push(`/subgraphs/${encodeURIComponent(value)}`);
    },
    [hash, router],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-[var(--text)] mb-1">
          Indexing Status
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          Check the sync health of any subgraph deployment across active indexers.
        </p>
      </div>

      {/* Lookup box */}
      <Card>
        <CardHeader>
          <CardTitle>Deployment Lookup</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLookup} className="flex gap-3">
            <input
              type="text"
              value={hash}
              onChange={(e) => setHash(e.target.value)}
              placeholder="Enter deployment IPFS hash (Qm... or bafy...)"
              className={cn(
                'flex-1 px-4 py-2.5 text-sm font-mono text-[var(--text)]',
                'placeholder-[var(--text-faint)] bg-[var(--bg-elevated)]',
                'border border-[var(--border)] rounded-[var(--radius-button)]',
                'outline-none focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--accent)]',
                'transition-shadow',
              )}
            />
            <button
              type="submit"
              disabled={!hash.trim()}
              className={cn(
                'px-5 py-2.5 text-sm font-medium rounded-[var(--radius-button)]',
                'bg-[var(--accent)] text-white',
                'hover:bg-[var(--accent-hover)] transition-colors',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              Check Status
            </button>
          </form>
          <p className="mt-2 text-xs text-[var(--text-faint)]">
            Queries each indexer&apos;s /status endpoint to show real-time sync progress, health, and errors.
          </p>
        </CardContent>
      </Card>

      {/* Top deployments by stake */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Top Deployments by Stake</CardTitle>
            <Badge variant="default">Quick access</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-1">
              {deployments?.map((dep) => (
                <Link
                  key={dep.id}
                  href={`/subgraphs/${dep.ipfsHash}`}
                  className={cn(
                    'flex items-center justify-between px-3 py-2.5 rounded-lg',
                    'hover:bg-[var(--bg-elevated)] transition-colors group',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-mono text-[var(--text)] group-hover:text-[var(--accent)] truncate transition-colors">
                      {shortenAddress(dep.ipfsHash, 12)}
                    </p>
                    <div className="flex gap-3 mt-0.5">
                      <span className="text-[10px] text-[var(--text-faint)]">
                        {dep.indexerAllocations.length} allocations
                      </span>
                      <span className="text-[10px] text-[var(--text-faint)]">
                        {dep.curatorSignals.length} curators
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <p className="text-sm font-mono text-[var(--text)]">
                      {formatGRT(weiToGRT(dep.stakedTokens))}
                    </p>
                    <p className="text-[10px] text-[var(--text-faint)]">staked</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
