'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { formatGRT, formatNumber, cn } from '@/lib/utils';
import {
  GENESIS_SUPPLY,
  CONTRACT_GROUPS,
  L2_TIMELINE,
  ISSUANCE_RATE_HISTORY,
  KEY_GIPS,
  CAVEATS,
} from '@/lib/grt-flow-data';

interface SupplyBreakdown {
  l1TotalSupply: number;
  l2TotalSupply: number;
  bridgeEscrow: number;
  globalSupply: number;
}
interface FlowData {
  blockNumber: number | null;
  supply: number;
  globalSupply: number;
  supplyBasis: 'onchain' | 'approx';
  supplyBreakdown: SupplyBreakdown | null;
  minted: number;
  burned: number;
  indexingRewards: number;
  queryFees: number;
  staked: number;
  delegated: number;
  signalled: number;
  allocated: number;
  issuancePerBlock: number;
  annualIssuance: number;
  issuanceRatePct: number;
  counts: { indexers: number; stakedIndexers: number; delegators: number; curators: number; currentEpoch: number };
  params: { protocolFeePct: number; curationTaxPct: number; delegationTaxPct: number; delegationRatio: number };
}
interface Resp {
  data: FlowData;
}

function Section({ title, summary, children }: { title: string; summary?: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-[var(--radius-card)] border-[0.5px] border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-card)]">
      <summary className="flex items-center justify-between cursor-pointer list-none px-4 py-3.5 select-none">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
          {summary && <p className="text-[11px] text-[var(--text-faint)] mt-0.5">{summary}</p>}
        </div>
        <svg className="w-4 h-4 text-[var(--text-faint)] transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-4 pb-4 pt-1 border-t-[0.5px] border-[var(--border)]">{children}</div>
    </details>
  );
}

// A single labelled node in the conceptual flow diagram.
function FlowNode({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub?: string; tone?: 'source' | 'pool' | 'sink' | 'neutral' }) {
  const border =
    tone === 'source' ? 'border-[var(--accent)]'
    : tone === 'pool' ? 'border-[var(--green)]'
    : tone === 'sink' ? 'border-[var(--red)]'
    : 'border-[var(--border)]';
  const dot =
    tone === 'source' ? 'bg-[var(--accent)]'
    : tone === 'pool' ? 'bg-[var(--green)]'
    : tone === 'sink' ? 'bg-[var(--red)]'
    : 'bg-[var(--text-faint)]';
  return (
    <div className={cn('rounded-lg border bg-[var(--bg-elevated)] px-3.5 py-3 w-full', border)}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={cn('w-1.5 h-1.5 rounded-full', dot)} />
        <p className="text-[11px] text-[var(--text-muted)]">{label}</p>
      </div>
      <p className="text-lg font-semibold font-mono text-[var(--text)] leading-tight">{value}</p>
      {sub && <p className="text-[10px] text-[var(--text-faint)] mt-0.5">{sub}</p>}
    </div>
  );
}

export default function GrtFlowPage() {
  const { data, isLoading, isError } = useQuery<Resp>({
    queryKey: ['grtFlow'],
    queryFn: async () => {
      const r = await fetch('/api/grt-flow');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 30 * 60 * 1000,
  });

  const d = data?.data;
  // Cumulative protocol issuance ≈ indexing rewards distributed (the honest issuance figure;
  // gross "minted" on L2 is dominated by bridge mints, so we do not headline it).
  const fmt = (g: number | undefined) => (g == null ? '—' : `${formatGRT(g)}`);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text)]">GRT Issuance &amp; Flow</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1 max-w-3xl">
          A live trace of GRT supply, issuance, and burns across Ethereum mainnet and Arbitrum One.
          Net supply = issuance − burns: linear per-block minting through the RewardsManager funds indexing
          rewards, while query-fee, curation and delegation taxes (plus slashing) burn GRT. Figures are
          sourced live from the <code className="text-[var(--accent-text)]">graph-network-arbitrum</code> GraphNetwork
          entity.
        </p>
        {d?.blockNumber && (
          <p className="text-[11px] text-[var(--text-faint)] mt-1.5 font-mono">
            Arbitrum block {formatNumber(d.blockNumber)} · epoch {d.counts.currentEpoch}
          </p>
        )}
      </div>

      {isError && (
        <Card>
          <CardContent className="py-5">
            <p className="text-sm text-[var(--red)]">Couldn&apos;t reach the network subgraph. Live figures unavailable; reference material below is unaffected.</p>
          </CardContent>
        </Card>
      )}

      <StatGrid>
        <StatCard
          label="Global GRT Supply"
          value={fmt(d?.globalSupply)}
          subtitle="L1 + L2 − bridge escrow"
          loading={isLoading}
          tag={d?.supplyBasis === 'onchain' ? 'live' : undefined}
          tooltip={
            d?.supplyBreakdown
              ? `Total GRT across both chains, on-chain and de-double-counted: L1 GraphToken ${formatGRT(d.supplyBreakdown.l1TotalSupply)} + L2GraphToken ${formatGRT(d.supplyBreakdown.l2TotalSupply)} − bridge escrow ${formatGRT(d.supplyBreakdown.bridgeEscrow)} (locked on L1, also minted on L2, so subtracted to avoid double-counting). Matches Graph Explorer's ~11.5B on-chain supply.`
              : 'Total GRT across Ethereum L1 and Arbitrum L2, de-double-counted for the bridge escrow. On-chain reads were unavailable, so this is the ~11.5B circulating-supply approximation.'
          }
        />
        <StatCard label="Annual Issuance" value={d ? `${d.issuanceRatePct.toFixed(2)}%` : '—'} subtitle={d ? `${formatGRT(d.annualIssuance)} GRT/yr` : undefined} loading={isLoading} tag="live" tooltip="Per-block protocol issuance annualised over the global GRT supply (L1 + L2 − bridge escrow). This is the basis Messari / Graph Explorer use, so it is directly comparable to the ~2.8% they report." />
        <StatCard label="L2 Net Supply" value={fmt(d?.supply)} subtitle="Arbitrum mint − burn" loading={isLoading} tooltip="The network subgraph's totalSupply: GRT minted minus burned on Arbitrum (net tokens present on L2). A subset of global supply, shown here as the L2 footprint, NOT the issuance denominator." />
        <StatCard label="Issuance / Block" value={d ? d.issuancePerBlock.toFixed(2) : '—'} subtitle="GRT, linear (GIP-0037)" loading={isLoading} />
        <StatCard label="Cumulative Indexing Rewards" value={fmt(d?.indexingRewards)} subtitle="lifetime issued to indexers + delegators" loading={isLoading} />
        <StatCard label="Cumulative Query Fees" value={fmt(d?.queryFees)} subtitle="GRT collected" loading={isLoading} />
      </StatGrid>

      {/* Conceptual flow diagram: sources → pool → sinks */}
      <Card>
        <CardContent className="py-5">
          <h2 className="text-sm font-semibold text-[var(--text)] mb-1">Issuance &amp; Burn Flow</h2>
          <p className="text-[11px] text-[var(--text-muted)] mb-5 max-w-3xl">
            Conceptual map of where GRT comes from and where it goes. Sources mint into the supply pool; burns
            remove it. Indexing rewards are split between indexers&apos; self-stake and their delegators.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr_auto_1fr] gap-4 lg:gap-2 items-center">
            {/* Sources */}
            <div className="space-y-3">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] font-medium">Sources</p>
              <FlowNode tone="source" label="Genesis mint (2020)" value={`${formatGRT(GENESIS_SUPPLY)} GRT`} sub="one-time, Ethereum L1" />
              <FlowNode tone="source" label="Protocol issuance" value={d ? `${formatGRT(d.annualIssuance)}/yr` : '—'} sub={d ? `${d.issuanceRatePct.toFixed(2)}% · ${d.issuancePerBlock.toFixed(1)} GRT/block` : 'linear per-block'} />
            </div>

            <Arrow />

            {/* Pool */}
            <div className="space-y-3">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] font-medium">Supply pool</p>
              <FlowNode tone="pool" label="L2 Net Supply (mint−burn)" value={fmt(d?.supply)} sub={d ? `staked ${formatGRT(d.staked)} · delegated ${formatGRT(d.delegated)}` : undefined} />
              <FlowNode tone="neutral" label="Signalled (curation)" value={fmt(d?.signalled)} sub="directs reward split" />
            </div>

            <Arrow />

            {/* Sinks / recipients */}
            <div className="space-y-3">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] font-medium">Distribution &amp; sinks</p>
              <FlowNode tone="neutral" label="Indexing rewards → indexers + delegators" value={fmt(d?.indexingRewards)} sub={d ? `delegation cap ${d.params.delegationRatio}× self-stake` : undefined} />
              <FlowNode tone="sink" label="Burned" value={d ? `${d.params.protocolFeePct.toFixed(1)}% / ${d.params.curationTaxPct.toFixed(1)}% / ${d.params.delegationTaxPct.toFixed(1)}%` : '—'} sub="query-fee / curation / delegation tax + slashing" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Supply composition + gross on-chain mint/burn (with bridge caveat) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardContent className="py-5">
            <h2 className="text-sm font-semibold text-[var(--text)] mb-3">Supply Composition</h2>
            {(() => {
              const b = d?.supplyBreakdown;
              const max = d?.globalSupply || GENESIS_SUPPLY;
              return (
                <div className="space-y-2.5">
                  <Bar label="Global supply (L1 + L2 − escrow)" value={d?.globalSupply ?? 0} max={max} color="var(--accent)" />
                  <Bar label="L1 GraphToken total (incl. escrow)" value={b?.l1TotalSupply ?? 0} max={max} color="var(--green)" />
                  <Bar label="L2GraphToken total" value={b?.l2TotalSupply ?? d?.supply ?? 0} max={max} color="var(--green)" />
                  <Bar label="Bridge escrow (locked on L1)" value={b?.bridgeEscrow ?? 0} max={max} color="var(--text-faint)" />
                </div>
              );
            })()}
            <p className="text-[10px] text-[var(--text-faint)] mt-4 leading-relaxed">
              Global supply is the L1 GraphToken total plus the L2GraphToken total minus the GRT locked in the L1
              bridge escrow, which backs the bridged L2 tokens, so it is subtracted to avoid double-counting.
              Genesis was a fixed {formatGRT(GENESIS_SUPPLY)} mint on Ethereum L1 (2020); the rest is net protocol
              issuance since.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[var(--text)]">Gross On-Chain Mint / Burn</h2>
              <Badge variant="warning">incl. bridge</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-[var(--bg-elevated)] px-3 py-3">
                <p className="text-[10px] text-[var(--text-faint)] mb-0.5">Cumulative Minted</p>
                <p className="text-xl font-semibold font-mono text-[var(--text)]">{fmt(d?.minted)}</p>
              </div>
              <div className="rounded-lg bg-[var(--bg-elevated)] px-3 py-3">
                <p className="text-[10px] text-[var(--text-faint)] mb-0.5">Cumulative Burned</p>
                <p className="text-xl font-semibold font-mono text-[var(--text)]">{fmt(d?.burned)}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[var(--amber-dim)] border border-[var(--amber)] mt-4">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-[var(--amber)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                On Arbitrum, gross mint/burn is dominated by <strong className="text-[var(--text)]">bridge flows</strong>,
                every L2 deposit mints and every withdrawal burns. These are not a clean issuance/burn measure;
                use cumulative indexing rewards and the per-block rate for issuance.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Issuance rate history */}
      <Card>
        <CardContent className="py-5">
          <h2 className="text-sm font-semibold text-[var(--text)] mb-1">Annualized Issuance Rate</h2>
          <p className="text-[11px] text-[var(--text-muted)] mb-4">Reported quarterly by Messari / Graph Explorer, against the ~11.5B circulating supply.</p>
          <div className="flex items-end gap-3 h-32">
            {ISSUANCE_RATE_HISTORY.map((p) => (
              <div key={p.period} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end" title={p.note}>
                <span className="text-[11px] font-mono text-[var(--text)]">{p.rate.toFixed(2)}%</span>
                <div className={cn('w-full rounded-t', p.note ? 'bg-[var(--text-faint)]' : 'bg-[var(--accent)]')} style={{ height: `${(p.rate / 3.2) * 100}%` }} />
                <span className="text-[10px] text-[var(--text-faint)] whitespace-nowrap">{p.period}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[var(--text-faint)] mt-4 leading-relaxed">
            These use the global circulating supply as denominator, the same basis as the live{' '}
            <strong className="text-[var(--text-muted)]">{d ? `${d.issuanceRatePct.toFixed(2)}%` : '—'}</strong> stat
            above ({d ? `${formatGRT(d.annualIssuance)} GRT/yr` : '~317M GRT/yr'} over ~11.5B global supply), so the
            figures are directly comparable.
          </p>
        </CardContent>
      </Card>

      {/* Explainer sections */}
      <div className="space-y-3">
        <Section title="How GRT issuance works" summary="Linear per-block minting, curation-weighted reward split, tax burns">
          <div className="text-[12px] text-[var(--text-muted)] leading-relaxed space-y-2.5 pt-2">
            <p>
              GRT is an uncapped ERC-20, minted at genesis as 10B tokens on Ethereum and now canonically the
              L2GraphToken on Arbitrum One. The <strong className="text-[var(--text)]">RewardsManager</strong> mints
              indexing rewards on reward collection (<code className="text-[var(--accent-text)]">graphToken().mint(staking, rewards)</code>),
              emitting <code className="text-[var(--accent-text)]">RewardsAssigned</code>. GIP-0037 replaced the original
              ~3% compounding model with a linear <code className="text-[var(--accent-text)]">issuancePerBlock</code>.
            </p>
            <p>
              Rewards split across subgraphs in proportion to curation signal, then to indexers by allocated stake,
              then between indexer self-stake and delegators via the per-indexer reward cut. Curators earn a fixed
              10% of query fees on their subgraphs. Delegation is capped at the network delegation ratio (16×) of an
              indexer&apos;s self-stake.
            </p>
            <p>
              Deflationary sinks: the 1% query-fee protocol tax, 1% curation tax, 0.5% delegation tax, rejected-dispute
              deposits, and slashing of malicious indexers, all burned via the ERC20Burnable <code className="text-[var(--accent-text)]">_burn</code>.
            </p>
          </div>
        </Section>

        <Section title="Contract reference" summary="Canonical addresses across L1, L2 and Horizon">
          <div className="space-y-5 pt-2">
            {CONTRACT_GROUPS.map((g) => (
              <div key={g.chain}>
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="text-[13px] font-semibold text-[var(--text)]">{g.chain}</h3>
                </div>
                <p className="text-[11px] text-[var(--text-faint)] mb-2.5">{g.subtitle}</p>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    {/* No visible header row by design; named for screen readers. */}
                    <thead className="sr-only">
                      <tr>
                        <th scope="col">Contract</th>
                        <th scope="col">Address</th>
                        <th scope="col">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {g.contracts.map((c) => (
                        <tr key={c.address} className="hover:bg-[var(--bg-elevated)]">
                          <td className="py-2 pr-3 text-[12px] text-[var(--text)] whitespace-nowrap">{c.name}</td>
                          <td className="py-2 pr-3">
                            <a href={`${g.explorerBase}${c.address}`} target="_blank" rel="noopener noreferrer" className="text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--accent-text)] transition-colors break-all">
                              {c.address}
                            </a>
                          </td>
                          <td className="py-2 text-[10px] text-[var(--text-faint)] hidden sm:table-cell">{c.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="L2 migration timeline" summary="Genesis → 100% rewards on Arbitrum → Horizon">
          <ol className="relative border-l border-[var(--border)] ml-1.5 mt-3 space-y-4">
            {L2_TIMELINE.map((t) => (
              <li key={t.date} className="ml-4">
                <span className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-[var(--accent)]" />
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-mono text-[var(--accent-text)] whitespace-nowrap">{t.date}</span>
                  <span className="text-[12px] font-medium text-[var(--text)]">{t.title}</span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{t.detail}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Key GIPs" summary="Governance proposals shaping issuance & flow">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-3">
            {KEY_GIPS.map((g) => (
              <div key={g.id} className="flex items-start gap-2.5 rounded-lg bg-[var(--bg-elevated)] px-3 py-2">
                <span className="text-[11px] font-mono text-[var(--accent-text)] whitespace-nowrap mt-px">{g.id}</span>
                <span className="text-[11px] text-[var(--text-muted)]">{g.title}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Caveats" summary="What the numbers do and don't mean">
          <ul className="space-y-2.5 pt-3">
            {CAVEATS.map((c, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="text-[var(--amber)] mt-px text-xs">▸</span>
                <span className="text-[11px] text-[var(--text-muted)] leading-relaxed">{c}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <p className="text-[11px] text-[var(--text-faint)] leading-relaxed max-w-3xl">
        Live aggregates from the graph-network-arbitrum GraphNetwork entity, cached 30 minutes. Issuance rate is
        derived as per-block issuance × L1-equivalent blocks/yr ÷ global GRT supply, where global supply is read
        on-chain as L1 + L2 totalSupply minus the bridge-escrow balance. Reference contracts, timeline and GIPs are
        static; verify Horizon payment-contract names on Arbiscan before relying on them.
      </p>
    </div>
  );
}

function Arrow() {
  return (
    <div className="hidden lg:flex items-center justify-center text-[var(--text-faint)]">
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
      </svg>
    </div>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] text-[var(--text-muted)]">{label}</span>
        <span className="text-[11px] font-mono text-[var(--text)]">{formatGRT(value)} GRT</span>
      </div>
      <div className="w-full h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
