'use client';

import { useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { usePayments, useGRTPrice, useEnrichedIndexers, useNetworkStats } from '@/hooks/useNetworkStats';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { weiToGRT, formatGRT, formatUSD, shortenAddress, formatRelativeTime, cn, GATEWAY_ALIASES, GATEWAY_CANONICAL } from '@/lib/utils';
import type { PaymentsEscrowAccount, PaymentsEscrowTransaction, GraphTallyTokensCollected } from '@/lib/queries';
import { GRAPH_NETWORK_EXPLORER_URL } from '@/lib/graph-network';

const ARBISCAN = 'https://arbiscan.io/address/';

/** Consistent accent color per gateway address (lowercase). */
const GATEWAY_COLORS: Record<string, string> = {
  '0xdde4cffd3d9052a9cb618fc05a1cd02be1f2f467': 'var(--accent)',
  '0xf6fcc27aaf1fcd8b254498c9794451d82afc673e': 'var(--green)',
  '0x7d14ae5f20cc2f6421317386aa8e79e8728353d9': 'var(--amber)',
  '0xdd6a6f76eb36b873c1c184e8b9b9e762fe216490': '#a78bfa',
};

function gatewayColor(address: string): string {
  return GATEWAY_COLORS[address.toLowerCase()] ?? 'var(--text-faint)';
}

type Tab = 'escrow' | 'activity' | 'collectors';

interface GatewayStats {
  payerId: string;
  name: string;
  receivers: number;
  totalEscrow: number;
  totalCollected: number;
}

function PageHeader() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-[var(--text)]">Payment Pipeline</h1>
      <p className="text-sm text-[var(--text-muted)] mt-1">
        Query fee payments flowing through Horizon&apos;s GraphTally/TAP system: escrow balances,
        on-chain redemptions, and collection activity. Data sourced from the PaymentsEscrow and
        GraphTallyCollector contracts via the{' '}
        <a
          href={GRAPH_NETWORK_EXPLORER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent-text)] hover:underline"
        >
          network subgraph
        </a>.
      </p>
    </div>
  );
}

/** Build a map of indexer address → display name from enriched data */
function useIndexerNames(): Map<string, string> {
  const { data } = useEnrichedIndexers();
  return useMemo(() => {
    const map = new Map<string, string>();
    if (data?.indexers) {
      for (const idx of data.indexers) {
        if (idx.name && idx.name !== idx.id) {
          map.set(idx.id.toLowerCase(), idx.name);
        }
      }
    }
    return map;
  }, [data]);
}

function ReceiverLink({ address, names }: { address: string; names: Map<string, string> }) {
  const name = names.get(address.toLowerCase());
  return (
    <Link
      href={`/payments/${address}`}
      className="text-[var(--accent-text)] hover:underline font-medium"
    >
      {name || shortenAddress(address)}
    </Link>
  );
}

function PayerLink({ address }: { address: string }) {
  const alias = GATEWAY_ALIASES[address.toLowerCase()];
  return (
    <a
      href={`${ARBISCAN}${address}`}
      target="_blank"
      rel="noopener noreferrer"
      title={address}
      className={cn(
        'text-sm hover:text-[var(--accent-text)] transition-colors',
        alias ? 'font-medium text-[var(--text)]' : 'font-mono text-[var(--text)]'
      )}
    >
      {alias ?? shortenAddress(address, 6)}
      <svg className="w-3 h-3 inline-block ml-1 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
    </a>
  );
}

// ─── Gateway Breakdown Card ──────────────────────────────────────────────────

function GatewayBreakdownCard({
  breakdown,
  selectedGateway,
  onSelect,
  grtPrice,
}: {
  breakdown: GatewayStats[];
  selectedGateway: string | null;
  onSelect: (id: string | null) => void;
  grtPrice: number;
}) {
  const maxEscrow = Math.max(...breakdown.map(g => g.totalEscrow), 1);
  const maxCollected = Math.max(...breakdown.map(g => g.totalCollected), 1);
  const totalEscrow = breakdown.reduce((s, g) => s + g.totalEscrow, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Gateway Breakdown</CardTitle>
          <div className="flex items-center gap-2">
            {selectedGateway && (
              <button
                onClick={() => onSelect(null)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                Clear filter ×
              </button>
            )}
            <Badge variant="default">{breakdown.length} gateways</Badge>
          </div>
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Click a row to filter the panels below by that gateway.
        </p>
      </CardHeader>
      <CardContent>
        {/* Mobile */}
        <div className="block md:hidden space-y-3">
          {breakdown.map((gw) => {
            const color = gatewayColor(gw.payerId);
            const isSelected = selectedGateway === gw.payerId;
            const escrowPct = totalEscrow > 0 ? (gw.totalEscrow / totalEscrow) * 100 : 0;
            return (
              <button
                key={gw.payerId}
                onClick={() => onSelect(isSelected ? null : gw.payerId)}
                className={cn(
                  'w-full text-left p-4 rounded-lg border transition-colors',
                  isSelected
                    ? 'border-[var(--accent)] bg-[var(--accent-dim)]'
                    : 'border-[var(--border)] hover:border-[var(--accent-hover)]'
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="font-medium text-sm text-[var(--text)]">{gw.name}</span>
                  </div>
                  <span className="text-xs text-[var(--text-faint)]">{gw.receivers} indexers</span>
                </div>
                <div className="space-y-1.5">
                  <div>
                    <div className="flex justify-between text-xs text-[var(--text-faint)] mb-1">
                      <span>Escrow</span>
                      <span>{formatGRT(gw.totalEscrow)} GRT · {escrowPct < 1 && escrowPct > 0 ? '<1' : escrowPct.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(gw.totalEscrow / maxEscrow) * 100}%`, backgroundColor: color }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-[var(--text-faint)] mb-1">
                      <span>Collected</span>
                      <span>{formatGRT(gw.totalCollected)} GRT</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(gw.totalCollected / maxCollected) * 100}%`, backgroundColor: color, opacity: 0.6 }} />
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Desktop */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Gateway</th>
                <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)] w-8">Indexers</th>
                <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Escrow Balance</th>
                <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Fees Collected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {breakdown.map((gw) => {
                const color = gatewayColor(gw.payerId);
                const isSelected = selectedGateway === gw.payerId;
                const escrowPct = totalEscrow > 0 ? (gw.totalEscrow / totalEscrow) * 100 : 0;
                const collectedPct = maxCollected > 0 ? (gw.totalCollected / maxCollected) * 100 : 0;
                return (
                  <tr
                    key={gw.payerId}
                    onClick={() => onSelect(isSelected ? null : gw.payerId)}
                    className={cn(
                      'cursor-pointer transition-colors',
                      isSelected
                        ? 'bg-[var(--accent-dim)]'
                        : 'hover:bg-[var(--bg-elevated)]'
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        <span className="font-medium text-sm text-[var(--text)]">{gw.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono text-sm text-[var(--text-muted)]">{gw.receivers}</span>
                    </td>
                    <td className="px-4 py-3 w-56">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden min-w-[60px]">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(gw.totalEscrow / maxEscrow) * 100}%`, backgroundColor: color }} />
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono text-xs text-[var(--text)]">{formatGRT(gw.totalEscrow)} GRT</p>
                          <p className="text-[10px] text-[var(--text-faint)]">{escrowPct < 1 && escrowPct > 0 ? '<1' : escrowPct.toFixed(0)}% share · {formatUSD(gw.totalEscrow * grtPrice)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 w-48">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden min-w-[60px]">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${collectedPct}%`, backgroundColor: color, opacity: 0.6 }} />
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono text-xs text-[var(--text)]">{formatGRT(gw.totalCollected)} GRT</p>
                          <p className="text-[10px] text-[var(--text-faint)]">{formatUSD(gw.totalCollected * grtPrice)}</p>
                        </div>
                      </div>
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

// ─── Main Page ───────────────────────────────────────────────────────────────

function PaymentsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data, isLoading, isError } = usePayments();
  const { data: priceData } = useGRTPrice();
  const { data: networkData } = useNetworkStats();
  const names = useIndexerNames();
  const [activeTab, setActiveTab] = useState<Tab>('escrow');
  const [selectedGateway, setSelectedGateway] = useState<string | null>(
    searchParams.get('gateway')
  );

  function handleGatewaySelect(id: string | null) {
    setSelectedGateway(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) {
      params.set('gateway', id);
    } else {
      params.delete('gateway');
    }
    router.replace(`/payments?${params.toString()}`, { scroll: false });
  }

  const grtPrice = priceData?.price ?? 0;

  // Per-gateway breakdown (computed from raw data, grouped by canonical address)
  const gatewayBreakdown = useMemo<GatewayStats[]>(() => {
    if (!data) return [];
    const canonical = (id: string) => GATEWAY_CANONICAL[id] ?? id;
    const allCanonical = new Set([
      ...data.escrowAccounts.map(a => canonical(a.payer.id.toLowerCase())),
      ...data.topCollectors.map(c => canonical(c.payer.id.toLowerCase())),
    ]);
    return Array.from(allCanonical).map((canonicalId) => {
      const aliases = new Set([canonicalId, ...Object.keys(GATEWAY_CANONICAL).filter(k => GATEWAY_CANONICAL[k] === canonicalId)]);
      const accounts = data.escrowAccounts.filter(a => aliases.has(a.payer.id.toLowerCase()));
      const collected = data.topCollectors.filter(c => aliases.has(c.payer.id.toLowerCase()));
      const totalEscrow = accounts.reduce((s, a) => s + BigInt(a.balance), BigInt(0));
      const totalCollected = collected.reduce((s, c) => s + BigInt(c.tokens), BigInt(0));
      return {
        payerId: canonicalId,
        name: GATEWAY_ALIASES[canonicalId] ?? shortenAddress(canonicalId),
        receivers: new Set(accounts.map(a => a.receiver.id)).size,
        totalEscrow: weiToGRT(totalEscrow.toString()),
        totalCollected: weiToGRT(totalCollected.toString()),
      };
    }).sort((a, b) => b.totalEscrow - a.totalEscrow);
  }, [data]);

  // Expand selected canonical gateway address to all aliases for filtering
  const selectedGatewayAddresses = useMemo(() => {
    if (!selectedGateway) return null;
    return new Set([selectedGateway, ...Object.keys(GATEWAY_CANONICAL).filter(k => GATEWAY_CANONICAL[k] === selectedGateway)]);
  }, [selectedGateway]);

  // Filtered slices (applied to all three panels)
  const filteredAccounts = useMemo(() =>
    selectedGatewayAddresses
      ? (data?.escrowAccounts ?? []).filter(a => selectedGatewayAddresses.has(a.payer.id.toLowerCase()))
      : (data?.escrowAccounts ?? []),
    [data, selectedGatewayAddresses]
  );
  const filteredTransactions = useMemo(() =>
    selectedGatewayAddresses
      ? (data?.recentTransactions ?? []).filter(tx => selectedGatewayAddresses.has(tx.payer.id.toLowerCase()))
      : (data?.recentTransactions ?? []),
    [data, selectedGatewayAddresses]
  );
  const filteredCollectors = useMemo(() =>
    selectedGatewayAddresses
      ? (data?.topCollectors ?? []).filter(c => selectedGatewayAddresses.has(c.payer.id.toLowerCase()))
      : (data?.topCollectors ?? []),
    [data, selectedGatewayAddresses]
  );

  // Stat card totals — reflect current filter
  const filteredEscrowTotal = useMemo(
    () => weiToGRT(filteredAccounts.reduce((s, a) => s + BigInt(a.balance), BigInt(0)).toString()),
    [filteredAccounts]
  );
  const filteredThawingTotal = useMemo(
    () => weiToGRT(filteredAccounts.reduce((s, a) => s + BigInt(a.totalAmountThawing), BigInt(0)).toString()),
    [filteredAccounts]
  );
  const filteredCollectedTotal = useMemo(
    () => weiToGRT(filteredCollectors.reduce((s, c) => s + BigInt(c.tokens), BigInt(0)).toString()),
    [filteredCollectors]
  );
  const filteredReceiverCount = useMemo(
    () => new Set(filteredAccounts.map(a => a.receiver.id)).size,
    [filteredAccounts]
  );

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
        <PageHeader />
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

  const selectedName = selectedGateway ? (GATEWAY_ALIASES[selectedGateway] ?? shortenAddress(selectedGateway)) : null;

  return (
    <div className="space-y-6">
      <PageHeader />

      {/* Overview stats — update with filter */}
      <StatGrid>
        <StatCard
          label={selectedName ? `${selectedName} Escrow` : 'Total Escrow Balance'}
          value={`${formatGRT(filteredEscrowTotal)} GRT`}
          subtitle={formatUSD(filteredEscrowTotal * grtPrice)}
        />
        <StatCard
          label={selectedName ? `${selectedName} Collected` : 'Total Collected'}
          value={`${formatGRT(filteredCollectedTotal)} GRT`}
          subtitle={formatUSD(filteredCollectedTotal * grtPrice)}
        />
        <StatCard
          label={selectedName ? 'Gateway' : 'Active Gateways'}
          value={selectedName ?? String(data.activePayers)}
          delta={selectedName ? undefined : { value: 'funding escrow', positive: true }}
        />
        <StatCard
          label="Active Receivers"
          value={String(selectedName ? filteredReceiverCount : data.activeReceivers)}
          delta={{ value: 'collecting fees', positive: true }}
        />
        {filteredThawingTotal > 0 && (
          <StatCard
            label="Escrow Thawing"
            value={`${formatGRT(filteredThawingTotal)} GRT`}
            subtitle={formatUSD(filteredThawingTotal * grtPrice)}
          />
        )}
      </StatGrid>

      {/* Network revenue context — ties the TAP pipeline to lifetime protocol revenue */}
      {networkData?.graphNetwork && (
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[var(--text-faint)]">Network revenue (lifetime)</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  TAP escrow above is the modern collection rail; these are the protocol-wide totals.
                </p>
              </div>
              <div className="flex gap-6">
                <div>
                  <p className="text-[10px] text-[var(--text-faint)]">Query Fees</p>
                  <p className="text-lg font-mono font-semibold text-[var(--accent-text)]">
                    {formatGRT(weiToGRT(networkData.graphNetwork.totalQueryFees))} GRT
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-faint)]">Indexing Rewards</p>
                  <p className="text-lg font-mono font-semibold text-[var(--green)]">
                    {formatGRT(weiToGRT(networkData.graphNetwork.totalIndexingRewards))} GRT
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Gateway breakdown / filter */}
      {gatewayBreakdown.length > 0 && (
        <GatewayBreakdownCard
          breakdown={gatewayBreakdown}
          selectedGateway={selectedGateway}
          onSelect={handleGatewaySelect}
          grtPrice={grtPrice}
        />
      )}

      {/* Tab selector */}
      <div className="flex gap-1 p-1 rounded-lg bg-[var(--bg-elevated)] w-fit">
        {([
          { key: 'escrow' as Tab, label: 'Escrow Accounts', count: filteredAccounts.length },
          { key: 'activity' as Tab, label: 'Recent Activity', count: filteredTransactions.length },
          { key: 'collectors' as Tab, label: 'Top Collectors', count: filteredCollectors.length },
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
        <EscrowAccountsPanel accounts={filteredAccounts} grtPrice={grtPrice} names={names} />
      )}
      {activeTab === 'activity' && (
        <TransactionsPanel transactions={filteredTransactions} grtPrice={grtPrice} names={names} />
      )}
      {activeTab === 'collectors' && (
        <TopCollectorsPanel collectors={filteredCollectors} grtPrice={grtPrice} names={names} />
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

export default function PaymentsPage() {
  return (
    <Suspense>
      <PaymentsInner />
    </Suspense>
  );
}

// ─── Panels ──────────────────────────────────────────────────────────────────

function EscrowAccountsPanel({
  accounts,
  grtPrice,
  names,
}: {
  accounts: PaymentsEscrowAccount[];
  grtPrice: number;
  names: Map<string, string>;
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
                <div className="mb-3">
                  <p className="text-xs text-[var(--text-faint)] mb-1">Gateway</p>
                  <PayerLink address={acct.payer.id} />
                </div>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-xs text-[var(--text-faint)] mb-1">Receiver</p>
                    <ReceiverLink address={acct.receiver.id} names={names} />
                  </div>
                  <p className="font-mono text-[var(--text)] text-sm">{formatGRT(balance)} GRT</p>
                </div>
                {thawing > 0 && (
                  <p className="font-mono text-xs text-[var(--amber)]">
                    {formatGRT(thawing)} thawing
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">
                  Gateway (Payer)
                </th>
                <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">
                  Receiver (Indexer)
                </th>
                <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">
                  Balance
                </th>
                <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">
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
                      <PayerLink address={acct.payer.id} />
                    </td>
                    <td className="px-4 py-3">
                      <ReceiverLink address={acct.receiver.id} names={names} />
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
  names,
}: {
  transactions: PaymentsEscrowTransaction[];
  grtPrice: number;
  names: Map<string, string>;
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
                <div className="flex items-center gap-3 min-w-0">
                  <Badge variant={typeVariant[tx.type] ?? 'default'}>
                    {typeLabel[tx.type] ?? tx.type}
                  </Badge>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <a
                        href={`${ARBISCAN}${tx.payer.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={tx.payer.id}
                        className={cn(
                          'hover:text-[var(--accent-text)] text-[var(--text-faint)]',
                          GATEWAY_ALIASES[tx.payer.id.toLowerCase()] ? 'text-sm font-medium' : 'font-mono'
                        )}
                      >
                        {GATEWAY_ALIASES[tx.payer.id.toLowerCase()] ?? shortenAddress(tx.payer.id, 6)}
                      </a>
                      <span className="text-[var(--text-faint)] shrink-0">&rarr;</span>
                      <ReceiverLink address={tx.receiver.id} names={names} />
                    </div>
                    {timestamp > 0 && (
                      <p className="text-xs text-[var(--text-faint)] mt-0.5">
                        {formatRelativeTime(timestamp)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
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
  names,
}: {
  collectors: GraphTallyTokensCollected[];
  grtPrice: number;
  names: Map<string, string>;
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

  // Aggregate by receiver
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
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm font-mono text-[var(--text-faint)] w-6 text-right shrink-0">
                    {i + 1}.
                  </span>
                  <ReceiverLink address={receiver} names={names} />
                </div>
                <div className="text-right shrink-0 ml-3">
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
