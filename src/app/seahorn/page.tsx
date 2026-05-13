'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

// ── Known Solana token mints ──────────────────────────────────────────────────

const MINTS: Record<string, { symbol: string; decimals: number; color: string }> = {
  So11111111111111111111111111111111111111112:  { symbol: 'SOL',  decimals: 9, color: '#9945FF' },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6, color: '#2775CA' },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', decimals: 6, color: '#26A17B' },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: 'JUP',  decimals: 6, color: '#C8A200' },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: 'BONK', decimals: 5, color: '#F99429' },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So:  { symbol: 'mSOL', decimals: 9, color: '#AAB4C9' },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: { symbol: 'WIF',  decimals: 6, color: '#E87D2A' },
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': { symbol: 'WETH', decimals: 8, color: '#627EEA' },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface SwapFields {
  user?: string;
  source_mint?: string;
  destination_mint?: string;
  in_amount?: string;
  out_amount?: string;
  hops?: number;
  slippage_bps?: number;
  platform_fee_bps?: number;
  exact_out?: boolean;
}

interface Swap {
  id: number;
  slot: number;
  tx_signature: string | null;
  commitment_status: string;
  created_at: string;
  fields: SwapFields | null;
}

interface Stats {
  total: number;
  finalized: number;
  latest_slot: number;
  unique_wallets: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mintInfo(mint?: string) {
  if (!mint) return null;
  return MINTS[mint] ?? null;
}

function mintLabel(mint?: string): string {
  if (!mint) return '—';
  return MINTS[mint]?.symbol ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function mintColor(mint?: string): string {
  if (!mint) return 'var(--text-muted)';
  return MINTS[mint]?.color ?? 'var(--text-muted)';
}

function formatAmount(raw?: string, mint?: string): string {
  if (!raw) return '—';
  const decimals = (mint ? MINTS[mint]?.decimals : undefined) ?? 6;
  const n = Number(raw) / Math.pow(10, decimals);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(3);
  return n.toFixed(4);
}

function shortAddr(addr?: string): string {
  if (!addr) return '—';
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function relativeTime(isoStr: string): string {
  const ms = Date.now() - new Date(isoStr).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

// ── Live Feed ─────────────────────────────────────────────────────────────────

function LiveFeed() {
  const [items, setItems] = useState<Swap[]>([]);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const poll = useCallback(async () => {
    try {
      const resp = await fetch('/api/seahorn/swaps?limit=25');
      if (!resp.ok) { setUnavailable(true); return; }
      const raw: Swap[] = await resp.json();
      if (!Array.isArray(raw)) { setUnavailable(true); return; }
      setUnavailable(false);
      const valid = raw.filter(s => s.fields?.source_mint && s.fields?.destination_mint);
      setItems(prev => {
        const prevMaxId = prev[0]?.id ?? 0;
        const freshIds = new Set(valid.filter(s => s.id > prevMaxId).map(s => s.id));
        if (freshIds.size > 0) {
          setNewIds(freshIds);
          setTimeout(() => setNewIds(new Set()), 900);
        }
        return valid;
      });
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 5_000);
    return () => clearInterval(t);
  }, [poll]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Live Jupiter Swaps</CardTitle>
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
              On-chain swaps indexed from Solana · refreshes every 5s
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-badge)] bg-[var(--green-dim)] text-[var(--green)] text-[10px] font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />
            Live
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-9 shimmer rounded" />
            ))}
          </div>
        ) : unavailable ? (
          <div className="py-8 text-center">
            <p className="text-[13px] text-[var(--text-muted)]">
              Seahorn service unreachable — check the gateway connection.
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-[13px] text-[var(--text-muted)]">
              No swaps indexed yet. The indexer may still be syncing.
            </p>
          </div>
        ) : (
          <div className="rounded-[var(--radius-button)] border border-[var(--border)] overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[1.4fr_1.8fr_1fr_auto_auto] gap-3 px-4 py-2 bg-[var(--bg-elevated)] border-b border-[var(--border)]">
              {['Wallet', 'Pair', 'Amount', 'Hops', 'When'].map(h => (
                <span key={h} className="text-[10px] text-[var(--text-muted)]">{h}</span>
              ))}
            </div>
            {/* Rows */}
            <div className="divide-y divide-[var(--border)]">
              {items.map(item => {
                const f = item.fields ?? {};
                const srcColor = mintColor(f.source_mint);
                const dstColor = mintColor(f.destination_mint);
                const isFinal = item.commitment_status === 'FINAL';
                const txUrl = item.tx_signature
                  ? `https://solscan.io/tx/${item.tx_signature}`
                  : null;

                return (
                  <div
                    key={item.id}
                    className={cn(
                      'grid grid-cols-[1.4fr_1.8fr_1fr_auto_auto] gap-3 px-4 py-2.5 transition-colors',
                      newIds.has(item.id)
                        ? 'bg-[var(--accent-dim)]'
                        : 'hover:bg-[var(--bg-elevated)]'
                    )}
                  >
                    {/* Wallet */}
                    <a
                      href={`https://solscan.io/account/${f.user}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                    >
                      {shortAddr(f.user)}
                    </a>

                    {/* Pair + amounts */}
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-[11px] font-mono font-medium" style={{ color: srcColor }}>
                        {mintLabel(f.source_mint)}
                      </span>
                      <span className="text-[10px] text-[var(--text-faint)]">→</span>
                      <span className="text-[11px] font-mono font-medium" style={{ color: dstColor }}>
                        {mintLabel(f.destination_mint)}
                      </span>
                      {isFinal ? (
                        <span className="ml-1 w-1 h-1 rounded-full bg-[var(--green)] shrink-0" title="FINAL" />
                      ) : (
                        <span className="ml-1 w-1 h-1 rounded-full bg-[var(--amber)] shrink-0" title={item.commitment_status} />
                      )}
                    </div>

                    {/* Amount */}
                    <div className="min-w-0">
                      <span className="text-[11px] font-mono text-[var(--text)]">
                        {formatAmount(f.in_amount, f.source_mint)}
                      </span>
                      {f.source_mint && (
                        <span className="text-[10px] text-[var(--text-faint)] ml-0.5">
                          {mintLabel(f.source_mint)}
                        </span>
                      )}
                    </div>

                    {/* Hops */}
                    <span className="text-[11px] font-mono text-[var(--text-muted)] text-center">
                      {f.hops ?? '—'}
                    </span>

                    {/* When */}
                    {txUrl ? (
                      <a
                        href={txUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-[var(--text-faint)] hover:text-[var(--accent)] whitespace-nowrap text-right transition-colors"
                      >
                        {relativeTime(item.created_at)}
                      </a>
                    ) : (
                      <span className="text-[11px] text-[var(--text-faint)] whitespace-nowrap text-right">
                        {relativeTime(item.created_at)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Top Pairs ─────────────────────────────────────────────────────────────────

function TopPairs({ items }: { items: Swap[] }) {
  const pairCounts: Record<string, { count: number; src: string; dst: string }> = {};
  for (const s of items) {
    const f = s.fields;
    if (!f?.source_mint || !f?.destination_mint) continue;
    const key = `${f.source_mint}|${f.destination_mint}`;
    if (!pairCounts[key]) pairCounts[key] = { count: 0, src: f.source_mint, dst: f.destination_mint };
    pairCounts[key].count++;
  }
  const pairs = Object.values(pairCounts).sort((a, b) => b.count - a.count).slice(0, 6);

  if (pairs.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Pairs (recent 25)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {pairs.map((p, i) => {
            const total = pairs.reduce((s, x) => s + x.count, 0);
            const pct = Math.round((p.count / total) * 100);
            return (
              <div key={i} className="flex items-center gap-3">
                <div className="flex items-center gap-1 w-28 shrink-0">
                  <span className="text-[11px] font-mono font-medium" style={{ color: mintColor(p.src) }}>
                    {mintLabel(p.src)}
                  </span>
                  <span className="text-[10px] text-[var(--text-faint)]">→</span>
                  <span className="text-[11px] font-mono font-medium" style={{ color: mintColor(p.dst) }}>
                    {mintLabel(p.dst)}
                  </span>
                </div>
                <div className="flex-1 h-1 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] opacity-70"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono text-[var(--text-muted)] w-8 text-right shrink-0">
                  {p.count}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Provider Info ─────────────────────────────────────────────────────────────

function ProviderInfo() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-[var(--radius-button)] border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
          {[
            { label: 'Endpoint',        value: 'https://solana.lodestar-indexer.com' },
            { label: 'Data Service',    value: '0xdDE3F913cb6D1332Bc018Eb63647020a87dD7B37' },
            { label: 'Provider',        value: '0xb43B2CCCceadA5292732a8C58ae134AdEFcE09Bb' },
            { label: 'Program indexed', value: 'Jupiter v6 (JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4)' },
            { label: 'Network',         value: 'Solana Mainnet' },
            { label: 'Payment',         value: 'TAP receipts · GraphTallyCollector on Arbitrum One' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-start gap-4 px-4 py-2.5">
              <span className="text-[11px] text-[var(--text-muted)] w-28 shrink-0 pt-px">{label}</span>
              <span className="text-[11px] font-mono text-[var(--text)] break-all">{value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── How It Works ──────────────────────────────────────────────────────────────

function HowItWorks() {
  const steps = [
    {
      n: '1',
      title: 'Yellowstone gRPC stream',
      body: 'The seahorn-indexer subscribes to Solana Mainnet via Chainstack\'s Dragon\'s Mouth gRPC endpoint, receiving every confirmed transaction in real time.',
    },
    {
      n: '2',
      title: 'Jupiter swap parsing',
      body: 'Each transaction is decoded against the Jupiter v6 program interface. Matching swaps — including multi-hop routes — are extracted with full field detail.',
    },
    {
      n: '3',
      title: 'Postgres + PostgREST',
      body: 'Parsed swaps are written to Postgres. PostgREST exposes a full REST query API, enabling filtering, ordering, and aggregation without a custom backend.',
    },
    {
      n: '4',
      title: 'TAP-verified access',
      body: 'The Dispatch gateway signs a TAP receipt for every query. The Seahorn gateway validates the receipt before serving data — enabling trustless, metered access on the RPC network.',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>How It Works</CardTitle>
        <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
          From Solana block to query result, in four steps
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {steps.map(step => (
            <div key={step.n} className="p-3.5 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)]">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-[var(--accent-dim)] text-[var(--accent)] text-[10px] font-bold flex items-center justify-center shrink-0">
                  {step.n}
                </span>
                <span className="text-[12px] font-semibold text-[var(--text)]">{step.title}</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SeahornPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [swaps, setSwaps] = useState<Swap[]>([]);

  // Stats polling
  useEffect(() => {
    const load = () =>
      fetch('/api/seahorn/stats')
        .then(r => r.json())
        .then((d: Stats) => {
          if (d && typeof d.total === 'number') setStats(d);
          else setStatsError(true);
        })
        .catch(() => setStatsError(true));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  // Swaps for Top Pairs (shares with LiveFeed implicitly — we fetch separately to keep components independent)
  useEffect(() => {
    fetch('/api/seahorn/swaps?limit=25')
      .then(r => r.json())
      .then((d: Swap[]) => { if (Array.isArray(d)) setSwaps(d.filter(s => s.fields?.source_mint && s.fields?.destination_mint)); })
      .catch(() => {});
    const t = setInterval(() => {
      fetch('/api/seahorn/swaps?limit=25')
        .then(r => r.json())
        .then((d: Swap[]) => { if (Array.isArray(d)) setSwaps(d.filter(s => s.fields?.source_mint && s.fields?.destination_mint)); })
        .catch(() => {});
    }, 5_000);
    return () => clearInterval(t);
  }, []);

  const loading = !stats && !statsError;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h1 className="text-[22px] font-semibold text-[var(--text)] tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
              Seahorn
            </h1>
            <Badge variant="accent">Solana Data</Badge>
            <Badge variant="success">Live</Badge>
          </div>
          <p className="text-[13px] text-[var(--text-muted)] max-w-xl">
            Real-time Solana data served via the RPC network — Jupiter v6 swaps indexed on-chain, verified with TAP receipts, and queryable through PostgREST.
          </p>
        </div>
        <div className="shrink-0 hidden sm:block">
          <div className="text-[11px] text-[var(--text-faint)] text-right">
            <p>Powered by Lodestar&apos;s</p>
            <p className="font-mono">SolanaDataService contract</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <StatGrid>
        <StatCard
          label="Total Indexed"
          value={loading ? '…' : statsError ? '—' : (stats!.total).toLocaleString()}
          subtitle="Jupiter swaps"
          loading={loading}
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.25c0 2.278-3.694 4.125-8.25 4.125S3.75 10.903 3.75 8.625" />
            </svg>
          }
        />
        <StatCard
          label="Finalized"
          value={loading ? '…' : statsError ? '—' : (stats!.finalized).toLocaleString()}
          subtitle="commitment_status = FINAL"
          loading={loading}
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Latest Slot"
          value={loading ? '…' : statsError ? '—' : (stats!.latest_slot).toLocaleString()}
          subtitle="Solana Mainnet"
          loading={loading}
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
          }
        />
        <StatCard
          label="Unique Wallets"
          value={loading ? '…' : statsError ? '—' : (stats!.unique_wallets).toLocaleString()}
          subtitle="from recent 200 swaps"
          loading={loading}
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          }
        />
      </StatGrid>

      {/* Live feed */}
      <LiveFeed />

      {/* Top pairs + Provider info (side by side on larger screens) */}
      <div className="grid gap-6 lg:grid-cols-2">
        <TopPairs items={swaps} />
        <ProviderInfo />
      </div>

      {/* How it works */}
      <HowItWorks />
    </div>
  );
}
