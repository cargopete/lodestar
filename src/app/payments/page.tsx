'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePayments, useGRTPrice } from '@/hooks/useNetworkStats';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { weiToGRT, formatGRT, formatUSD, shortenAddress, formatRelativeTime, cn } from '@/lib/utils';
import type { PaymentsEscrowAccount, PaymentsEscrowTransaction, GraphTallyTokensCollected } from '@/lib/queries';

type Tab = 'escrow' | 'activity' | 'collectors';

function ExperimentalBanner() {
  return (
    <div className="flex items-center gap-3 p-4 rounded-lg border border-[var(--amber)]/30 bg-[var(--amber)]/5">
      <svg className="w-5 h-5 text-[var(--amber)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
      </svg>
      <div>
        <p className="text-sm font-medium text-[var(--amber)]">Experimental Feature — In Development</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          This dashboard tracks GraphTally/TAP payment pipeline data from Horizon smart contracts.
          Data accuracy and coverage are being validated. Features may change.
        </p>
      </div>
    </div>
  );
}

export default function PaymentsPage() {
  const { data, isLoading, isError } = usePayments();
  const { data: priceData } = useGRTPrice();
  const [activeTab, setActiveTab] = useState<Tab>('escrow');

  const grtPrice = priceData?.price ?? 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-6">
        <ExperimentalBanner />
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-[var(--text-muted)]">
              Payment data is currently unavailable. The subgraph may not yet expose payment entities.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalEscrow = weiToGRT(data.totalEscrowBalance);
  const totalThawing = weiToGRT(data.totalThawing);
  const totalCollected = weiToGRT(data.totalCollected);

  return (
    <div className="space-y-6">
      <ExperimentalBanner />

      {/* Overview stats */}
      <StatGrid>
        <StatCard
          label="Total Escrow Balance"
          value={`${formatGRT(totalEscrow)} GRT`}
          subtitle={formatUSD(totalEscrow * grtPrice)}
        />
        <StatCard
          label="Total Collected"
          value={`${formatGRT(totalCollected)} GRT`}
          subtitle={formatUSD(totalCollected * grtPrice)}
        />
        <StatCard
          label="Active Gateways"
          value={String(data.activePayers)}
          delta={{ value: 'funding escrow', positive: true }}
        />
        <StatCard
          label="Active Receivers"
          value={String(data.activeReceivers)}
          delta={{ value: 'collecting fees', positive: true }}
        />
        {totalThawing > 0 && (
          <StatCard
            label="Escrow Thawing"
            value={`${formatGRT(totalThawing)} GRT`}
            subtitle={formatUSD(totalThawing * grtPrice)}
          />
        )}
      </StatGrid>

      {/* Tab selector */}
      <div className="flex gap-1 p-1 rounded-lg bg-[var(--bg-elevated)] w-fit">
        {([
          { key: 'escrow' as Tab, label: 'Escrow Accounts', count: data.escrowAccounts.length },
          { key: 'activity' as Tab, label: 'Recent Activity', count: data.recentTransactions.length },
          { key: 'collectors' as Tab, label: 'Top Collectors', count: data.topCollectors.length },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              activeTab === tab.key
                ? 'bg-[var(--bg-surface)] text-[var(--text)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            )}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Active tab content */}
      {activeTab === 'escrow' && (
        <EscrowAccountsPanel accounts={data.escrowAccounts} grtPrice={grtPrice} />
      )}
      {activeTab === 'activity' && (
        <TransactionsPanel transactions={data.recentTransactions} grtPrice={grtPrice} />
      )}
      {activeTab === 'collectors' && (
        <TopCollectorsPanel collectors={data.topCollectors} grtPrice={grtPrice} />
      )}

      {/* Info panel */}
      <Card>
        <CardHeader>
          <CardTitle>About GraphTally / TAP Payments</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold text-[var(--text)] mb-2">How Payments Work</h4>
              <p className="text-sm text-[var(--text-muted)]">
                Gateways deposit GRT into escrow accounts for each indexer they route queries to.
                As indexers serve queries, they receive signed receipts which are periodically
                aggregated into Receipt Aggregate Vouchers (RAVs) and redeemed on-chain. The
                collected amount is split between the indexer, their delegation pool, the data
                service, and protocol tax.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-[var(--text)] mb-2">Escrow Health</h4>
              <p className="text-sm text-[var(--text-muted)]">
                Each escrow account represents a gateway&apos;s commitment to pay a specific
                indexer. The balance indicates available funds for payment, while thawing
                tokens are being withdrawn. Low or depleted escrow balances may indicate
                reduced query fee income for the affected indexers and their delegators.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EscrowAccountsPanel({
  accounts,
  grtPrice,
}: {
  accounts: PaymentsEscrowAccount[];
  grtPrice: number;
}) {
  if (accounts.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-[var(--text-muted)]">
          No active escrow accounts found.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Escrow Accounts</CardTitle>
          <Badge variant="default">{accounts.length} accounts</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {/* Mobile cards */}
        <div className="block md:hidden space-y-3">
          {accounts.map((acct) => {
            const balance = weiToGRT(acct.balance);
            const thawing = weiToGRT(acct.totalAmountThawing);
            return (
              <div
                key={acct.id}
                className="p-4 rounded-lg border border-[var(--border)] hover:border-[var(--accent-hover)] transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-xs text-[var(--text-faint)]">Gateway</p>
                    <p className="font-mono text-sm text-[var(--text)]">
                      {shortenAddress(acct.payer.id)}
                    </p>
                  </div>
                  <p className="font-mono text-[var(--text)] text-sm">{formatGRT(balance)} GRT</p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-[var(--text-faint)]">Receiver</p>
                    <Link
                      href={`/payments/${acct.receiver.id}`}
                      className="font-mono text-sm text-[var(--accent)] hover:underline"
                    >
                      {shortenAddress(acct.receiver.id)}
                    </Link>
                  </div>
                  {thawing > 0 && (
                    <p className="font-mono text-xs text-[var(--amber)]">
                      {formatGRT(thawing)} thawing
                    </p>
                  )}
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
                  Gateway (Payer)
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-muted)] uppercase">
                  Receiver (Indexer)
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)] uppercase">
                  Balance
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)] uppercase">
                  Thawing
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {accounts.map((acct) => {
                const balance = weiToGRT(acct.balance);
                const thawing = weiToGRT(acct.totalAmountThawing);
                return (
                  <tr key={acct.id} className="hover:bg-[var(--bg-elevated)]">
                    <td className="px-4 py-3">
                      <p className="font-mono text-sm text-[var(--text)]">
                        {shortenAddress(acct.payer.id)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/payments/${acct.receiver.id}`}
                        className="font-mono text-sm text-[var(--accent)] hover:underline"
                      >
                        {shortenAddress(acct.receiver.id)}
                      </Link>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function TransactionsPanel({
  transactions,
  grtPrice,
}: {
  transactions: PaymentsEscrowTransaction[];
  grtPrice: number;
}) {
  if (transactions.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-[var(--text-muted)]">
          No recent transactions found.
        </CardContent>
      </Card>
    );
  }

  const typeLabel: Record<string, string> = {
    deposit: 'Deposit',
    redeem: 'Redeem',
    withdraw: 'Withdraw',
    thaw: 'Thaw',
    cancelThaw: 'Cancel Thaw',
  };

  const typeVariant: Record<string, 'success' | 'error' | 'default'> = {
    deposit: 'success',
    redeem: 'success',
    withdraw: 'error',
    thaw: 'default',
    cancelThaw: 'default',
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Recent Transactions</CardTitle>
          <Badge variant="default">{transactions.length} events</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {transactions.map((tx) => {
            const amount = weiToGRT(tx.amount);
            const timestamp = Number(tx.timestamp);
            return (
              <div
                key={tx.id}
                className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-elevated)]"
              >
                <div className="flex items-center gap-3">
                  <Badge variant={typeVariant[tx.type] ?? 'default'}>
                    {typeLabel[tx.type] ?? tx.type}
                  </Badge>
                  <div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-[var(--text-faint)]">
                        {shortenAddress(tx.payer.id)}
                      </span>
                      <span className="text-[var(--text-faint)]">&rarr;</span>
                      <Link
                        href={`/payments/${tx.receiver.id}`}
                        className="font-mono text-[var(--accent)] hover:underline"
                      >
                        {shortenAddress(tx.receiver.id)}
                      </Link>
                    </div>
                    {timestamp > 0 && (
                      <p className="text-xs text-[var(--text-faint)] mt-0.5">
                        {formatRelativeTime(timestamp)}
                      </p>
                    )}
                  </div>
                </div>
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
  );
}

function TopCollectorsPanel({
  collectors,
  grtPrice,
}: {
  collectors: GraphTallyTokensCollected[];
  grtPrice: number;
}) {
  if (collectors.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-[var(--text-muted)]">
          No collection data found.
        </CardContent>
      </Card>
    );
  }

  // Aggregate by receiver for a leaderboard view
  const byReceiver = new Map<string, bigint>();
  for (const c of collectors) {
    const prev = byReceiver.get(c.receiver.id) ?? BigInt(0);
    byReceiver.set(c.receiver.id, prev + BigInt(c.tokens));
  }
  const sorted = [...byReceiver.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : -1));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Top Fee Collectors</CardTitle>
          <Badge variant="default">{sorted.length} indexers</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sorted.map(([receiver, tokens], i) => {
            const amount = weiToGRT(tokens.toString());
            return (
              <div
                key={receiver}
                className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-elevated)]"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono text-[var(--text-faint)] w-6 text-right">
                    {i + 1}.
                  </span>
                  <Link
                    href={`/payments/${receiver}`}
                    className="font-mono text-sm text-[var(--accent)] hover:underline"
                  >
                    {shortenAddress(receiver)}
                  </Link>
                </div>
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
  );
}
