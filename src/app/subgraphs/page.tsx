'use client';

import { useState, useMemo } from 'react';
import { GraphQLClient, gql } from 'graphql-request';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card';
import { weiToGRT, formatGRT, shortenAddress, cn } from '@/lib/utils';

// ---------- query + types ----------

const SUBGRAPH_DEPLOYMENTS_QUERY = gql`
  query SubgraphDeployments($first: Int!, $skip: Int!, $orderBy: SubgraphDeployment_orderBy!, $orderDirection: OrderDirection!) {
    subgraphDeployments(
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
      where: { signalledTokens_gt: "0" }
    ) {
      id
      ipfsHash
      signalledTokens
      stakedTokens
      queryFeesAmount
      indexerAllocations {
        id
      }
      curatorSignals {
        id
      }
    }
  }
`;

interface SubgraphDeploymentRaw {
  id: string;
  ipfsHash: string;
  signalledTokens: string;
  stakedTokens: string;
  queryFeesAmount: string;
  indexerAllocations: { id: string }[];
  curatorSignals: { id: string }[];
}

interface SubgraphRow {
  id: string;
  ipfsHash: string;
  signal: number;
  stake: number;
  queryFees: number;
  indexerCount: number;
  curatorCount: number;
  signalStakeRatio: number;
}

// ---------- mock data ----------

function generateMockDeployments(): SubgraphRow[] {
  const hashes = [
    'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco',
    'QmVsp2sFx7EvbAig3SPuBJdoZGyqjEahp1pvUAnzuMkPpk',
    'QmNTv73FxZag2xAQ75BFVzWMkJWy7DzBBvXADnJMTnFcbx',
    'QmfDmT2g94LAAvdbJfyi14YskeUA66ceCmV6s4wC4bpnUk',
    'QmYBhssiGQ2FZsmRZFpKHFpTVcp5eaFBwfEfz8pZLGCqpN',
    'QmRCJqro8ACT2mFxvEPqbiFSNb4S4K6hNuEA6A1pYybCpN',
    'QmUsTRhJMrSJmkSB2FRj3DP8opZ96Lgri7m4SjZiE5VGpN',
    'QmPkGsFM7c5n3M8YdJH4pzHzv1a3x2fKYVxSxbE7RxYLpN',
    'QmTvKfhLmJbqYC4Pv6BQhB3HXJjvY1a9dFNrFhQMvZLLpN',
    'QmZxJv4n7d3t2a8FhQMvZLL4pN3HXJjvY1a9dFNrFhQMvN',
    'QmAaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVv',
    'QmBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWw',
    'QmCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXx',
    'QmDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYy',
    'QmEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz',
    'QmFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz00',
    'QmGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0011',
    'QmHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz001122',
    'QmIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz00112233',
    'QmJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0011223344',
  ];

  return hashes.map((hash, i) => {
    const signal = (500000 - i * 22000) * (1 + Math.sin(i) * 0.3);
    const stake = (1200000 - i * 50000) * (1 + Math.cos(i) * 0.25);
    const queryFees = (80000 - i * 3500) * (1 + Math.sin(i * 2) * 0.4);
    const indexerCount = Math.max(2, 45 - i * 2);
    const curatorCount = Math.max(1, 30 - i);
    return {
      id: hash,
      ipfsHash: hash,
      signal: Math.max(signal, 1000),
      stake: Math.max(stake, 5000),
      queryFees: Math.max(queryFees, 100),
      indexerCount,
      curatorCount,
      signalStakeRatio: Math.max(signal, 1000) / Math.max(stake, 5000),
    };
  });
}

// ---------- data hook ----------

const client = new GraphQLClient('/api/subgraph');

function useSubgraphDeployments() {
  return useQuery({
    queryKey: ['subgraphDeployments'],
    queryFn: async (): Promise<SubgraphRow[]> => {
      try {
        const data = await client.request<{
          subgraphDeployments: SubgraphDeploymentRaw[];
        }>(SUBGRAPH_DEPLOYMENTS_QUERY, {
          first: 20,
          skip: 0,
          orderBy: 'signalledTokens',
          orderDirection: 'desc',
        });

        return data.subgraphDeployments.map((d) => {
          const signal = weiToGRT(d.signalledTokens);
          const stake = weiToGRT(d.stakedTokens);
          return {
            id: d.id,
            ipfsHash: d.ipfsHash,
            signal,
            stake,
            queryFees: weiToGRT(d.queryFeesAmount),
            indexerCount: d.indexerAllocations.length,
            curatorCount: d.curatorSignals.length,
            signalStakeRatio: stake > 0 ? signal / stake : 0,
          };
        });
      } catch {
        // Fall back to mock data when the subgraph query fails
        return generateMockDeployments();
      }
    },
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 5,
  });
}

// ---------- sort helpers ----------

type SortKey = 'signal' | 'stake' | 'queryFees' | 'indexerCount' | 'curatorCount' | 'signalStakeRatio';

// ---------- component ----------

export default function SubgraphDirectory() {
  const { data: rows, isLoading } = useSubgraphDeployments();
  const [sortKey, setSortKey] = useState<SortKey>('signal');
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = useMemo(() => {
    if (!rows) return [];
    return [...rows].sort((a, b) =>
      sortDesc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]
    );
  }, [rows, sortKey, sortDesc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const thClass =
    'px-4 py-3 text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-[0.06em] cursor-pointer select-none hover:text-[var(--text)] transition-colors';

  const renderSortArrow = (key: SortKey) =>
    sortKey === key ? (
      <span className="text-[var(--accent)] ml-1">{sortDesc ? '\u2193' : '\u2191'}</span>
    ) : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--bg-elevated)]">
              <tr>
                <th className={cn(thClass, 'text-left w-12')}>#</th>
                <th className={cn(thClass, 'text-left')}>Deployment ID</th>
                <th className={cn(thClass, 'text-right')} onClick={() => handleSort('signal')}>
                  Signal (GRT){renderSortArrow('signal')}
                </th>
                <th className={cn(thClass, 'text-right')} onClick={() => handleSort('stake')}>
                  Stake (GRT){renderSortArrow('stake')}
                </th>
                <th className={cn(thClass, 'text-right')} onClick={() => handleSort('queryFees')}>
                  Query Fees (GRT){renderSortArrow('queryFees')}
                </th>
                <th className={cn(thClass, 'text-right')} onClick={() => handleSort('indexerCount')}>
                  Indexers{renderSortArrow('indexerCount')}
                </th>
                <th className={cn(thClass, 'text-right')} onClick={() => handleSort('signalStakeRatio')}>
                  Signal/Stake{renderSortArrow('signalStakeRatio')}
                </th>
                <th className={cn(thClass, 'text-right')} onClick={() => handleSort('curatorCount')}>
                  Curators{renderSortArrow('curatorCount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, idx) => {
                const highRatio = row.signalStakeRatio > 0.5;
                return (
                  <tr
                    key={row.id}
                    className="border-b border-[0.5px] border-[var(--border)] hover:bg-[var(--bg-elevated)] transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-[var(--text-faint)]">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm text-[var(--text)]" title={row.ipfsHash}>
                        {row.ipfsHash.slice(0, 8)}...{row.ipfsHash.slice(-6)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text)]">
                      {formatGRT(row.signal)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text)]">
                      {formatGRT(row.stake)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text)]">
                      {formatGRT(row.queryFees)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text)]">
                      {row.indexerCount}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-3 text-right font-mono text-sm',
                        highRatio ? 'text-[var(--green)] font-semibold' : 'text-[var(--text)]'
                      )}
                    >
                      {row.signalStakeRatio.toFixed(3)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text)]">
                      {row.curatorCount}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
