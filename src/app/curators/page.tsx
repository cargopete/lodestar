'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCuratorLeaderboard } from '@/hooks/useNetworkStats';
import { Card, CardContent } from '@/components/ui/Card';
import { Pagination } from '@/components/ui/Pagination';
import { weiToGRT, formatGRT, shortenAddress, cn } from '@/lib/utils';

const PAGE_SIZE = 50;

function LeaderboardTable() {
  const [page, setPage] = useState(0);
  const { data, isLoading, isError } = useCuratorLeaderboard({ first: PAGE_SIZE, skip: page * PAGE_SIZE });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        <span className="ml-3 text-sm text-[var(--text-muted)]">Loading curators…</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="text-sm text-[var(--text-muted)] py-8 text-center">
        Could not load curator data. Check that the Graph API key is configured.
      </p>
    );
  }

  const thBase = 'px-4 py-3 text-[11px] font-medium text-[var(--text-muted)] select-none';

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[var(--bg-elevated)]">
            <tr>
              <th className={cn(thBase, 'text-left w-12')}>#</th>
              <th className={cn(thBase, 'text-left')}>Address</th>
              <th className={cn(thBase, 'text-right')}>Signalled (GRT)</th>
              <th className={cn(thBase, 'text-right')}>Realized Rewards</th>
              <th className={cn(thBase, 'text-right')}>Return %</th>
              <th className={cn(thBase, 'text-right')}>Active Signals</th>
              <th className={cn(thBase, 'text-right')}>Total Signals</th>
            </tr>
          </thead>
          <tbody>
            {data.map((curator, idx) => {
              const signalled = weiToGRT(curator.totalSignalledTokens);
              const realized = weiToGRT(curator.realizedRewards);
              const returnPct = signalled > 0 ? (realized / signalled) * 100 : 0;
              return (
                <tr
                  key={curator.id}
                  className="border-b border-[0.5px] border-[var(--border)] hover:bg-[var(--bg-elevated)] transition-colors"
                >
                  <td className="px-4 py-3 text-sm text-[var(--text-faint)]">{page * PAGE_SIZE + idx + 1}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/curators/${curator.id}`}
                      className="font-mono text-sm text-[var(--text)] hover:text-[var(--accent)] transition-colors"
                    >
                      {shortenAddress(curator.id, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text)]">
                    {formatGRT(signalled)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm">
                    {realized > 0
                      ? <span className="text-[var(--green)]">+{formatGRT(realized)}</span>
                      : <span className="text-[var(--text-faint)]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm">
                    {realized > 0
                      ? <span className={cn(returnPct >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
                          {returnPct.toFixed(2)}%
                        </span>
                      : <span className="text-[var(--text-faint)]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text)]">
                    {curator.activeSignalCount}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text-faint)]">
                    {curator.signalCount}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {data.map((curator, idx) => {
          const signalled = weiToGRT(curator.totalSignalledTokens);
          const realized = weiToGRT(curator.realizedRewards);
          const returnPct = signalled > 0 ? (realized / signalled) * 100 : 0;
          return (
            <Link key={curator.id} href={`/curators/${curator.id}`} className="block">
              <div className="p-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent-hover)] transition-colors">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--text-faint)]">#{page * PAGE_SIZE + idx + 1}</span>
                    <span className="font-mono text-sm text-[var(--text)]">{shortenAddress(curator.id, 6)}</span>
                  </div>
                  {realized > 0 && (
                    <span className={cn('text-sm font-mono font-semibold', returnPct >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
                      {returnPct.toFixed(2)}%
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded bg-[var(--bg-elevated)]">
                    <p className="text-[10px] text-[var(--text-faint)]">Signalled</p>
                    <p className="text-xs font-mono text-[var(--text)]">{formatGRT(signalled)}</p>
                  </div>
                  <div className="p-2 rounded bg-[var(--bg-elevated)]">
                    <p className="text-[10px] text-[var(--text-faint)]">Realized</p>
                    <p className={cn('text-xs font-mono', realized > 0 ? 'text-[var(--green)]' : 'text-[var(--text-faint)]')}>
                      {realized > 0 ? `+${formatGRT(realized)}` : '—'}
                    </p>
                  </div>
                  <div className="p-2 rounded bg-[var(--bg-elevated)]">
                    <p className="text-[10px] text-[var(--text-faint)]">Active</p>
                    <p className="text-xs font-mono text-[var(--text)]">{curator.activeSignalCount}</p>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        totalItems={(page + (data.length === PAGE_SIZE ? 2 : 1)) * PAGE_SIZE}
        onPageChange={setPage}
      />
    </>
  );
}

export default function CuratorsPage() {
  const [address, setAddress] = useState('');
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = address.trim();
    if (trimmed) router.push(`/curators/${trimmed}`);
  };

  return (
    <div className="space-y-6">
      {/* Address lookup */}
      <Card>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Jump to address — 0x…"
              className="flex-1 px-4 py-2.5 text-sm font-mono bg-[var(--bg-elevated)] text-[var(--text)] border-[0.5px] border-[var(--border)] rounded-[var(--radius-button)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
            <button
              type="submit"
              disabled={!address.trim()}
              className="px-5 py-2.5 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-button)] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              View Profile
            </button>
          </form>
        </CardContent>
      </Card>

      {/* Leaderboard */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--text)]">Curator Leaderboard</h2>
          <span className="text-xs text-[var(--text-faint)]">Sorted by signalled GRT</span>
        </div>
        <Suspense fallback={<div className="h-32 flex items-center justify-center"><div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" /></div>}>
          <LeaderboardTable />
        </Suspense>
      </Card>
    </div>
  );
}
