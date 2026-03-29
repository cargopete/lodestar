'use client';

import { use } from 'react';
import Link from 'next/link';
import { useIndexerPayments, useGRTPrice, useENSName } from '@/hooks/useNetworkStats';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { weiToGRT, formatGRT, formatUSD, shortenAddress, formatRelativeTime, cn } from '@/lib/utils';

export default function IndexerPaymentsPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = use(params);
  const { data, isLoading, isError } = useIndexerPayments(address);
  const { data: priceData } = useGRTPrice();
  const { data: ensData } = useENSName(address);

  const grtPrice = priceData?.price ?? 0;
  const displayName = ensData?.ensName ?? shortenAddress(address);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-[var(--text-muted)]">
              Payment data unavailable for this address.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalEscrow = weiToGRT(data.totalEscrowBalance);
  const totalThawing = weiToGRT(data.totalThawing);
  const totalCollected = weiToGRT(data.totalCollected);

  // Compute redemptions for the revenue breakdown
  const redeemTransactions = data.recentTransactions.filter((tx) => tx.type === 'redeem');
  const totalRedeemed = redeemTransactions.reduce(
    (sum, tx) => sum + weiToGRT(tx.amount),
    0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/payments"
          className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-[var(--text)]">{displayName}</h1>
            <Badge variant="default">Experimental</Badge>
          </div>
          <p className="text-xs font-mono text-[var(--text-faint)]">{address}</p>
        </div>
        <Link
          href={`/indexers/${address}`}
          className="ml-auto text-xs text-[var(--accent)] hover:underline"
        >
          View Indexer Profile &rarr;
        </Link>
      </div>

      {/* Stats */}
      <StatGrid>
        <StatCard
          label="Escrow Balance"
          value={`${formatGRT(totalEscrow)} GRT`}
          subtitle={formatUSD(totalEscrow * grtPrice)}
        />
        <StatCard
          label="Total Collected"
          value={`${formatGRT(totalCollected)} GRT`}
          subtitle={formatUSD(totalCollected * grtPrice)}
        />
        <StatCard
          label="Active Escrow Accounts"
          value={String(data.escrowAccounts.length)}
          delta={{ value: `from ${data.activePayers} gateway${data.activePayers !== 1 ? 's' : ''}`, positive: true }}
        />
        {totalThawing > 0 && (
          <StatCard
            label="Thawing"
            value={`${formatGRT(totalThawing)} GRT`}
            subtitle={formatUSD(totalThawing * grtPrice)}
          />
        )}
      </StatGrid>

      {/* Revenue breakdown bar */}
      {totalCollected > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Collection Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-[var(--text-muted)]">Total Fees Collected</span>
                  <span className="font-mono text-[var(--text)]">{formatGRT(totalCollected)} GRT</span>
                </div>
                <ProgressBar value={100} max={100} variant="teal" size="sm" />
              </div>
              {totalRedeemed > 0 && (
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--text-muted)]">Recent Redemptions</span>
                    <span className="font-mono text-[var(--text)]">{formatGRT(totalRedeemed)} GRT</span>
                  </div>
                  <ProgressBar
                    value={totalCollected > 0 ? (totalRedeemed / totalCollected) * 100 : 0}
                    max={100}
                    variant="teal"
                    size="sm"
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Escrow accounts */}
      {data.escrowAccounts.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Escrow Accounts</CardTitle>
              <Badge variant="default">{data.escrowAccounts.length}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {/* Mobile cards */}
            <div className="block md:hidden space-y-3">
              {data.escrowAccounts.map((acct) => {
                const balance = weiToGRT(acct.balance);
                const thawing = weiToGRT(acct.totalAmountThawing);
                return (
                  <div
                    key={acct.id}
                    className="p-4 rounded-lg border border-[var(--border)]"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-xs text-[var(--text-faint)]">Gateway</p>
                        <p className="font-mono text-sm text-[var(--text)]">
                          {shortenAddress(acct.payer.id)}
                        </p>
                      </div>
                      <p className="font-mono text-[var(--text)]">{formatGRT(balance)} GRT</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 rounded bg-[var(--bg-elevated)]">
                        <p className="text-[10px] text-[var(--text-faint)]">USD Value</p>
                        <p className="text-xs font-mono text-[var(--text)]">
                          {formatUSD(balance * grtPrice)}
                        </p>
                      </div>
                      <div className="p-2 rounded bg-[var(--bg-elevated)]">
                        <p className="text-[10px] text-[var(--text-faint)]">Thawing</p>
                        <p className={cn('text-xs font-mono', thawing > 0 ? 'text-[var(--amber)]' : 'text-[var(--text-faint)]')}>
                          {thawing > 0 ? formatGRT(thawing) : '-'}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-muted)] uppercase">
                      Gateway
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)] uppercase">
                      Balance
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)] uppercase">
                      Thawing
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)] uppercase">
                      Thaw Deadline
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {data.escrowAccounts.map((acct) => {
                    const balance = weiToGRT(acct.balance);
                    const thawing = weiToGRT(acct.totalAmountThawing);
                    const thawEnd = Number(acct.thawEndTimestamp);
                    return (
                      <tr key={acct.id} className="hover:bg-[var(--bg-elevated)]">
                        <td className="px-4 py-3">
                          <p className="font-mono text-sm text-[var(--text)]">
                            {shortenAddress(acct.payer.id)}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-mono text-[var(--text)]">{formatGRT(balance)} GRT</p>
                          <p className="text-xs text-[var(--text-faint)]">
                            {formatUSD(balance * grtPrice)}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p
                            className={cn(
                              'font-mono',
                              thawing > 0 ? 'text-[var(--amber)]' : 'text-[var(--text-faint)]'
                            )}
                          >
                            {thawing > 0 ? formatGRT(thawing) : '-'}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="text-sm text-[var(--text-muted)]">
                            {thawEnd > 0 ? formatRelativeTime(thawEnd) : '-'}
                          </p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent transactions */}
      {data.recentTransactions.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Transaction History</CardTitle>
              <Badge variant="default">{data.recentTransactions.length} events</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.recentTransactions.map((tx) => {
                const amount = weiToGRT(tx.amount);
                const timestamp = Number(tx.timestamp);
                const typeColors: Record<string, string> = {
                  deposit: 'text-[var(--green)]',
                  redeem: 'text-[var(--green)]',
                  withdraw: 'text-[var(--red)]',
                  thaw: 'text-[var(--amber)]',
                };
                return (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-elevated)]"
                  >
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={
                          tx.type === 'deposit' || tx.type === 'redeem'
                            ? 'success'
                            : tx.type === 'withdraw'
                            ? 'error'
                            : 'default'
                        }
                      >
                        {tx.type}
                      </Badge>
                      <div>
                        <p className="font-mono text-sm text-[var(--text-faint)]">
                          from {shortenAddress(tx.payer.id)}
                        </p>
                        {timestamp > 0 && (
                          <p className="text-xs text-[var(--text-faint)] mt-0.5">
                            {formatRelativeTime(timestamp)}
                          </p>
                        )}
                      </div>
                    </div>
                    <p className={cn('font-mono text-sm', typeColors[tx.type] ?? 'text-[var(--text)]')}>
                      {tx.type === 'withdraw' ? '-' : '+'}{formatGRT(amount)} GRT
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top payers to this indexer */}
      {data.topCollectors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Collections by Gateway</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.topCollectors.map((c) => {
                const amount = weiToGRT(c.tokens);
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-elevated)]"
                  >
                    <p className="font-mono text-sm text-[var(--text)]">
                      {shortenAddress(c.payer.id)}
                    </p>
                    <div className="text-right">
                      <p className="font-mono text-sm text-[var(--text)]">{formatGRT(amount)} GRT</p>
                      <p className="text-xs text-[var(--text-faint)]">{formatUSD(amount * grtPrice)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
