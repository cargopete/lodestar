'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';
import { IndexerTable } from '@/components/tables/IndexerTable';
import { useGRTBalance } from '@/hooks/useGRTBalance';
import { formatGRTFull } from '@/lib/utils';

export default function IndexerDirectory() {
  const { isConnected } = useAccount();
  const { balance } = useGRTBalance();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-semibold text-white tracking-tight">Indexer Directory</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Performance and economic metrics for all indexers — APR, effective cut, stake, and more.
          For community rankings based on network contribution, see the{' '}
          <Link href="/leaderboard" className="text-[var(--accent)] hover:underline">Monthly Leaderboard</Link>.
        </p>
      </div>

      {/* Delegate banner */}
      {isConnected && (
        <div className="flex items-center justify-between gap-4 px-5 py-4 rounded-lg border border-[var(--accent-hover)] bg-[var(--accent-dim)]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[var(--accent)] flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--text)]">
                Delegate directly from Lodestar
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                Pick an indexer below, then use the Delegate panel on their profile page.
                {balance > 0 && (
                  <span className="font-mono text-[var(--accent)]"> {formatGRTFull(balance)} GRT available.</span>
                )}
              </p>
            </div>
          </div>
          <span className="flex-shrink-0 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-[var(--accent)]/15 text-[var(--accent)]">
            Experimental
          </span>
        </div>
      )}

      <IndexerTable />
    </div>
  );
}
