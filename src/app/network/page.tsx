'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

interface ServiceResult {
  ok: boolean;
  latencyMs: number;
  endpoint?: string;
  error?: string;
  [k: string]: unknown;
}
interface Snapshot {
  generatedAt: number;
  services: {
    dispatch: ServiceResult;
    camp: ServiceResult;
    seahorn: ServiceResult;
    substreams: ServiceResult;
    mainline: ServiceResult;
    wsaas: ServiceResult;
  };
}

const short = (a?: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? '—');
const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { maximumFractionDigits: d });
const ago = (iso?: string) => {
  if (!iso) return '—';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 90 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
};

const SERVICES = [
  { key: 'dispatch', name: 'Dispatch', kind: 'JSON-RPC · Arb One + Base' },
  { key: 'camp', name: 'Camp', kind: 'Decoded Arbitrum One' },
  { key: 'seahorn', name: 'Seahorn', kind: 'Structured Solana' },
  { key: 'substreams', name: 'Substreams', kind: 'Streaming compute' },
  { key: 'mainline', name: 'Mainline', kind: 'Firehose · Ethereum' },
  { key: 'wsaas', name: 'WSaaS', kind: 'WebSocket · events' },
] as const;

function Stamp({ r }: { r: ServiceResult }) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono text-[var(--text-faint)]">
      <span className={cn('w-1.5 h-1.5 rounded-full', r.ok ? 'bg-[var(--green)]' : 'bg-[var(--amber)]')} />
      <span className="text-[var(--accent)]">paid query</span>
      {typeof r.latencyMs === 'number' && <span>· {r.latencyMs} ms</span>}
      {r.endpoint && <span className="truncate hidden sm:inline">· {r.endpoint}</span>}
    </div>
  );
}

function PanelShell({
  name,
  kind,
  r,
  children,
}: {
  name: string;
  kind: string;
  r?: ServiceResult;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)]">{name}</h3>
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] mt-0.5">{kind}</p>
        </div>
        {r && <Stamp r={r} />}
      </div>
      {r && !r.ok ? (
        <p className="text-[11px] text-[var(--amber)] font-mono">{r.error ?? 'unavailable'}</p>
      ) : (
        children
      )}
    </Card>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide">{label}</div>
    <div className="text-sm font-mono text-[var(--text)]">{value}</div>
  </div>
);

export default function NetworkLivePage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/network/snapshot', { cache: 'no-store' });
      setSnap(await r.json());
    } catch {
      /* keep last good snapshot */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 15_000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  const s = snap?.services;
  const dispatch = s?.dispatch as (ServiceResult & { chains?: { arbitrum: Rec; base: Rec } }) | undefined;
  const camp = s?.camp as (ServiceResult & { status?: Rec; transfers?: Rec[] }) | undefined;
  const seahorn = s?.seahorn as (ServiceResult & { buys?: Rec[] }) | undefined;
  const substreams = s?.substreams as (ServiceResult & { blocks?: Rec[]; package?: string; module?: string }) | undefined;
  const mainline = s?.mainline as (ServiceResult & { chain?: string; attestationsVerified?: boolean; blocks?: Rec[] }) | undefined;
  const wsaas = s?.wsaas as (ServiceResult & { authorised?: boolean; messages?: string[] }) | undefined;

  return (
    <div className="space-y-6">
      {/* ── Hero / explainer ─────────────────────────────────────────────── */}
      <div className="pb-2 border-b border-[var(--border)]">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-semibold text-[var(--text)]">Network Live</h1>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--green)]">
            <span className="w-2 h-2 rounded-full bg-[var(--green)] animate-pulse" />
            live
          </span>
        </div>
        <p className="text-sm text-[var(--text-muted)] mt-1 max-w-3xl">
          Every panel below is assembled <strong className="text-[var(--text)]">on load</strong> from a different Horizon
          data service running on Lodestar infrastructure — four independent services, each answering a real, TAP-metered
          paid query to render this one screen. Nothing here is cached chain data. Auto-refreshes every 15s.
        </p>
      </div>

      {/* ── Flow strip ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-mono text-[var(--text-faint)]">this page</span>
        <span className="text-[var(--text-faint)]">←</span>
        {SERVICES.map((svc, i) => {
          const r = s?.[svc.key];
          return (
            <span key={svc.key} className="inline-flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-button)] border',
                  !r ? 'border-[var(--border)] text-[var(--text-faint)]'
                    : r.ok ? 'border-[var(--green)]/30 text-[var(--green)]'
                    : 'border-[var(--amber)]/30 text-[var(--amber)]',
                )}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full', !r ? 'bg-[var(--text-faint)] animate-pulse' : r.ok ? 'bg-[var(--green)]' : 'bg-[var(--amber)]')} />
                {svc.name}
              </span>
              {i < SERVICES.length - 1 && <span className="text-[var(--text-faint)]">·</span>}
            </span>
          );
        })}
        {loading && <span className="text-[var(--text-faint)] ml-1">querying…</span>}
      </div>

      {/* ── 2×2 panels ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Dispatch */}
        <PanelShell name="Dispatch" kind="JSON-RPC · Arbitrum One + Base" r={dispatch}>
          <div className="grid grid-cols-2 gap-4">
            {(['arbitrum', 'base'] as const).map((c) => {
              const d = dispatch?.chains?.[c];
              return (
                <div key={c} className="rounded-[var(--radius-button)] border border-[var(--border)] p-3 space-y-2">
                  <div className="text-[11px] font-semibold text-[var(--text-muted)] capitalize">{c === 'arbitrum' ? 'Arbitrum One' : 'Base'}</div>
                  <Stat label="Block" value={d ? `#${fmt(Number(d.block), 0)}` : '—'} />
                  <Stat label="Base fee" value={d ? `${fmt(Number(d.baseFeeGwei), 6)} gwei` : '—'} />
                  <Stat label="Gas used" value={d ? `${fmt(Number(d.gasUsedPct), 1)}%` : '—'} />
                  <Stat label="Txns" value={d ? fmt(Number(d.txCount), 0) : '—'} />
                </div>
              );
            })}
          </div>
        </PanelShell>

        {/* Camp */}
        <PanelShell name="Camp" kind="Decoded Arbitrum One · Amp node" r={camp}>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Indexed block" value={camp?.status ? `#${fmt(Number(camp.status.latestIndexedBlock), 0)}` : '—'} />
            <Stat label="Freshness" value={ago(camp?.status?.latestIndexedAt as string)} />
            <Stat label="Window" value={camp?.status ? `${fmt(Number(camp.status.blocksIndexed), 0)} blk` : '—'} />
          </div>
          <div>
            <div className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide mb-1.5">Recent decoded USDC transfers</div>
            <div className="space-y-1">
              {(camp?.transfers ?? []).slice(0, 4).map((t, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="text-[var(--text-faint)]">{short(t.from as string)} → {short(t.to as string)}</span>
                  <span className="text-[var(--text)]">{fmt(Number(t.value) / 1e6, 2)} USDC</span>
                </div>
              ))}
              {camp?.ok && (camp?.transfers?.length ?? 0) === 0 && <div className="text-[11px] text-[var(--text-faint)]">no transfers in window</div>}
            </div>
            <p className="text-[10px] text-[var(--text-faint)] mt-2 italic">Also decodes Horizon protocol events (stake, provision, collect) via /v1/horizon/*.</p>
          </div>
        </PanelShell>

        {/* Seahorn */}
        <PanelShell name="Seahorn" kind="Structured Solana · Yellowstone" r={seahorn}>
          <div className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide mb-1.5">Latest Pump.fun buys (live mainnet)</div>
          <div className="space-y-1.5">
            {(seahorn?.buys ?? []).slice(0, 5).map((b, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-[var(--text-faint)]">{short(b.mint as string)}</span>
                <span className="text-[var(--text-muted)]">{short(b.user as string)}</span>
                <span className="text-[var(--text)]">{fmt(Number(b.solCost) / 1e9, 3)} SOL</span>
              </div>
            ))}
            {seahorn?.ok && (seahorn?.buys?.length ?? 0) === 0 && <div className="text-[11px] text-[var(--text-faint)]">no buys in window</div>}
          </div>
        </PanelShell>

        {/* Substreams */}
        <PanelShell name="Substreams" kind="Real Arbitrum One · firecore + Pinax firehose" r={substreams}>
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide">
              {substreams?.package ? `${substreams.package} · ${substreams.module}` : 'substreams stream'}
            </div>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--green)]/15 text-[var(--green)]">live · Pinax firehose</span>
          </div>
          <div className="mt-1.5 space-y-1">
            {(substreams?.blocks ?? []).slice(0, 5).map((b, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-[var(--text-faint)]">block #{String(b.block)}</span>
                <span className="text-[var(--text-muted)] truncate">{String(b.timestamp ?? '').replace('T', ' ').slice(0, 19)}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[var(--text-faint)] mt-2 italic">Real Arbitrum One blocks sourced from Pinax firehose, streamed through the SDS consumer sidecar over gRPC and metered per block.</p>
        </PanelShell>

        {/* Mainline */}
        <PanelShell name="Mainline" kind="Firehose data service · Ethereum mainnet" r={mainline}>
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide">raw fork-aware firehose blocks</div>
            {mainline?.attestationsVerified && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--green)]/15 text-[var(--green)]">attestations ✓ verified</span>
            )}
          </div>
          <div className="mt-1.5 space-y-1">
            {(mainline?.blocks ?? []).slice(0, 5).map((b, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-[var(--text-faint)]">block #{String(b.n)}</span>
                <span className="text-[var(--text)]">{fmt(Number(b.bytes), 0)} bytes</span>
                <span className="text-[var(--text-muted)]">sha {String(b.sha256)}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[var(--text-faint)] mt-2 italic">Real Ethereum mainnet firehose, proxied from Pinax, each block EIP-712 attested by the operator and TAP-gated.</p>
        </PanelShell>

        {/* WSaaS */}
        <PanelShell name="WSaaS" kind="WebSocket data service · pre-parsed events" r={wsaas}>
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide">pre-parsed transfers / swaps over WebSocket</div>
            {wsaas?.authorised && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--green)]/15 text-[var(--green)]">WS · TAP authorised</span>
            )}
          </div>
          <div className="mt-1.5 space-y-1">
            {(wsaas?.messages ?? []).slice(0, 3).map((m, i) => (
              <div key={i} className="text-[10px] font-mono text-[var(--text-muted)] break-all leading-relaxed">{m}…</div>
            ))}
            {wsaas?.ok && (wsaas?.messages?.length ?? 0) === 0 && <div className="text-[11px] text-[var(--text-faint)]">connected — awaiting next event</div>}
          </div>
          <p className="text-[10px] text-[var(--text-faint)] mt-2 italic">A signed TAP receipt opens the WebSocket; the gateway relays a live upstream Pinax stream and bills per message.</p>
        </PanelShell>
      </div>

      {snap && (
        <p className="text-[10px] text-[var(--text-faint)] font-mono text-right">
          snapshot {new Date(snap.generatedAt).toLocaleTimeString()} · 4 services queried in parallel
        </p>
      )}
    </div>
  );
}

type Rec = Record<string, unknown>;
