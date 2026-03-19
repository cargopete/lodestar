'use client';

import { useIndexers } from '@/hooks/useNetworkStats';
import { useGRTPrice } from '@/hooks/useNetworkStats';
import { RedelegationPage } from '@/components/ui/RedelegationCalculator';
import { weiToGRT, shortenAddress, resolveIndexerName } from '@/lib/utils';
import type { Indexer } from '@/lib/queries';

export default function CalculatorPage() {
  const { data: indexersData, isLoading: indexersLoading } = useIndexers({
    first: 100,
    orderBy: 'stakedTokens',
    orderDirection: 'desc',
  });

  const { data: priceData } = useGRTPrice();
  const grtPrice = priceData?.price ?? 0;

  if (indexersLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const indexers = (indexersData?.indexers || []).map((indexer: Indexer) => ({
    id: indexer.id,
    name: resolveIndexerName(indexer.account, indexer.id),
    stakedTokens: indexer.stakedTokens,
    delegatedTokens: indexer.delegatedTokens,
    indexingRewardCut: indexer.indexingRewardCut,
  }));

  if (indexers.length < 2) {
    return (
      <div className="text-center py-24">
        <h2 className="text-xl font-semibold text-[var(--text)] mb-2">
          Not Enough Indexers
        </h2>
        <p className="text-[var(--text-muted)]">
          Need at least 2 indexers to compare. Please check your data source.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="p-4 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-hover)]">
        <div className="flex gap-3">
          <svg
            className="w-5 h-5 text-[var(--accent)] flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="text-sm text-[var(--text)]">
              <strong>How it works:</strong> When you undelegate, your GRT enters
              a 28-day thawing period during which you earn no rewards. This
              calculator factors in the opportunity cost against potential gains
              from a new indexer.
            </p>
          </div>
        </div>
      </div>

      {/* Calculator */}
      <RedelegationPage indexers={indexers} grtPrice={grtPrice} />

      {/* Methodology note */}
      <div className="p-4 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]">
        <h3 className="text-sm font-medium text-[var(--text)] mb-2">
          Calculation Methodology
        </h3>
        <ul className="text-sm text-[var(--text-muted)] space-y-1">
          <li>
            • APR estimates based on current delegation pool size and indexer
            reward cut
          </li>
          <li>
            • Assumes 300M GRT annual network rewards (issuance)
          </li>
          <li>
            • Gas costs estimated for Arbitrum One (~0.5 GRT per transaction)
          </li>
          <li>
            • Break-even calculation: total switch cost ÷ daily reward gain
          </li>
          <li>
            • Recommendation thresholds: &lt;30 days = strong, 30-60 days =
            reasonable, &gt;60 days = not recommended
          </li>
        </ul>
      </div>
    </div>
  );
}
