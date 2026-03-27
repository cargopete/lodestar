'use client';

import Link from 'next/link';
import { IndexerTable } from '@/components/tables/IndexerTable';

export default function IndexerDirectory() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text)]">Indexer Directory</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Performance and economic metrics for all indexers — APR, effective cut, stake, and more.
          For community rankings based on network contribution, see the{' '}
          <Link href="/leaderboard" className="text-[var(--accent)] hover:underline">Monthly Leaderboard</Link>.
        </p>
      </div>
      <IndexerTable />
    </div>
  );
}
