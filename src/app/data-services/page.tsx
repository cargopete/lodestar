'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DATA_SERVICES,
  TIERS,
  catalogueStats,
  explorerUrl,
  DATA_SERVICES_LAST_REVIEWED,
  type DataService,
  type ProviderStatus,
  type ServiceTier,
} from '@/data/data-services';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { cn } from '@/lib/utils';
import { Playground } from '@/components/data-services/Playground';

// ── Provider traffic light — the single most decision-relevant signal ──────────
const PROVIDER_META: Record<
  ProviderStatus,
  { dot: string; label: string; text: string }
> = {
  active: { dot: 'bg-[var(--green)]', label: 'Active providers', text: 'text-[var(--green)]' },
  'single-self-run': { dot: 'bg-[var(--amber)]', label: '1 self-run', text: 'text-[var(--amber)]' },
  none: { dot: 'bg-[var(--text-faint)]', label: 'No providers', text: 'text-[var(--text-faint)]' },
};

function ProviderLight({ status, withLabel = true }: { status: ProviderStatus; withLabel?: boolean }) {
  const m = PROVIDER_META[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('w-2 h-2 rounded-full shrink-0', m.dot)} />
      {withLabel && <span className={cn('text-[11px] font-medium', m.text)}>{m.label}</span>}
    </span>
  );
}

function ChainChip({ service }: { service: DataService }) {
  const { paymentLabel, dataLabel, isMainnet } = service.chain;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono whitespace-nowrap',
          isMainnet
            ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
            : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
        )}
        title={isMainnet ? 'Payments settle on a production mainnet' : 'Payments on testnet / local chain'}
      >
        {paymentLabel}
      </span>
      {dataLabel && (
        <>
          <span className="text-[10px] text-[var(--text-faint)]">·</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono whitespace-nowrap bg-[var(--bg-elevated)] text-[var(--text-faint)]">
            {dataLabel}
          </span>
        </>
      )}
    </span>
  );
}

function StackChips({ stack }: { stack: string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {stack.map((s) => (
        <span
          key={s}
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--bg-elevated)] text-[var(--text-muted)]"
        >
          {s}
        </span>
      ))}
    </span>
  );
}

// ── Card (summary only) ────────────────────────────────────────────────────────
function ServiceCard({
  service,
  expanded,
  onToggle,
}: {
  service: DataService;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Card
      hover
      onClick={onToggle}
      className={cn(
        'flex flex-col gap-3 h-full transition-shadow',
        expanded && 'ring-1 ring-[var(--accent)]/40 border-[var(--accent)]/40'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3
              className="text-[15px] font-semibold text-[var(--text)] tracking-tight truncate"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {service.name}
            </h3>
            {service.grc && (
              <span className="text-[10px] font-mono text-[var(--text-faint)]">{service.grc}</span>
            )}
          </div>
          <p className="text-[10px] text-[var(--text-faint)] mt-0.5">{service.builtBy}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ProviderLight status={service.providerStatus} withLabel={false} />
          <svg
            className={cn(
              'w-4 h-4 text-[var(--text-faint)] transition-transform duration-300',
              expanded && 'rotate-180 text-[var(--accent)]'
            )}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      <p className="text-xs text-[var(--text-muted)] leading-relaxed flex-1">{service.tagline}</p>

      <div className="flex items-center justify-between gap-2">
        <Badge variant={service.statusVariant}>{service.statusLabel}</Badge>
        <ProviderLight status={service.providerStatus} />
      </div>

      <div className="space-y-1.5 pt-1 border-t border-[var(--border)]">
        <ChainChip service={service} />
        <StackChips stack={service.stack} />
      </div>
    </Card>
  );
}

// ── Full-width detail panel ────────────────────────────────────────────────────
function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-[var(--border)] last:border-0">
      <span className="text-[11px] text-[var(--text-faint)] shrink-0">{label}</span>
      <span className="text-[11px] text-[var(--text)] text-right">{children}</span>
    </div>
  );
}

function StepList({ title, steps }: { title: string; steps?: string[] }) {
  if (!steps || steps.length === 0) return null;
  return (
    <div>
      <h4 className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wide mb-2.5">{title}</h4>
      <ol className="space-y-2">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2.5 text-xs text-[var(--text-muted)] leading-relaxed">
            <span className="font-mono text-[10px] text-[var(--accent)] shrink-0 mt-0.5">{String(i + 1).padStart(2, '0')}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wide mb-2">{label}</h4>
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">{value}</p>
    </div>
  );
}

const DetailPanel = ({
  service,
  columns,
  colIndex,
  onClose,
  innerRef,
}: {
  service: DataService;
  columns: number;
  colIndex: number;
  onClose: () => void;
  innerRef: React.RefObject<HTMLDivElement | null>;
}) => {
  const m = PROVIDER_META[service.providerStatus];
  // Centre of the selected card's column, so the caret points at it.
  const caretLeft = `${((colIndex + 0.5) / columns) * 100}%`;

  return (
    <div
      ref={innerRef}
      onClick={(e) => e.stopPropagation()}
      className="relative mt-4 rounded-[var(--radius-card)] border border-[var(--accent)]/30 bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-card)]"
    >
      {/* caret pointing up at the selected card */}
      <span
        aria-hidden
        className="absolute -top-[7px] w-3 h-3 rotate-45 bg-[var(--bg-elevated)] border-l border-t border-[var(--accent)]/30"
        style={{ left: caretLeft, transform: 'translateX(-50%) rotate(45deg)' }}
      />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-xl font-semibold text-[var(--text)]" style={{ fontFamily: 'var(--font-display)' }}>
              {service.name}
            </h2>
            {service.grc && <span className="text-[11px] font-mono text-[var(--text-faint)]">{service.grc}</span>}
          </div>
          <p className="text-[11px] text-[var(--text-faint)] mt-1">{service.builtBy}</p>
          <div className="flex items-center gap-2.5 mt-3">
            <Badge variant={service.statusVariant}>{service.statusLabel}</Badge>
            <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium', m.text)}>
              <span className={cn('w-2 h-2 rounded-full', m.dot)} />
              {m.label}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[var(--text-faint)] hover:text-[var(--text)] transition-colors shrink-0 -mt-1 -mr-1 p-1"
          aria-label="Collapse"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* three-column body — uses the full width instead of strangling it */}
      <div className="mt-6 grid gap-x-8 gap-y-6 lg:grid-cols-3">
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-muted)] leading-relaxed">{service.description}</p>
          <div>
            <MetaRow label="Stage">{service.stage}</MetaRow>
            <MetaRow label="Min provision">{service.minProvision ?? '—'}</MetaRow>
            <MetaRow label="Chain"><ChainChip service={service} /></MetaRow>
            <MetaRow label="Stack"><StackChips stack={service.stack} /></MetaRow>
          </div>
        </div>
        <StepList title="Become a provider" steps={service.becomeProvider} />
        <StepList title="Consume" steps={service.consume} />
      </div>

      {/* lower band — status, contracts, fees, notable */}
      <div className="mt-6 pt-5 border-t border-[var(--border)] grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        <DetailBlock label="Provider status" value={service.providerNote} />

        {service.contracts && service.contracts.length > 0 && (
          <div>
            <h4 className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wide mb-2.5">Contracts</h4>
            <div className="space-y-2.5">
              {service.contracts.map((c) => {
                const url = explorerUrl(c);
                return (
                  <div key={c.address} className="text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[var(--text-muted)]">{c.label}</span>
                      {c.unverified && (
                        <span
                          className="text-[9px] px-1 py-0.5 rounded bg-[var(--amber-dim)] text-[var(--amber)] leading-none"
                          title="Sourced from repo config / forum — verify on a block explorer before relying on it"
                        >
                          unverified
                        </span>
                      )}
                    </div>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[10px] text-[var(--accent)] hover:underline break-all"
                      >
                        {c.address}
                      </a>
                    ) : (
                      <span className="font-mono text-[10px] text-[var(--text-faint)] break-all">{c.address}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {service.fees && <DetailBlock label="Fees" value={service.fees} />}
        {service.notable && <DetailBlock label="Notable" value={service.notable} />}
      </div>

      <Playground service={service} />

      <div className="mt-5 pt-4 border-t border-[var(--border)] flex flex-wrap gap-2">
        {service.links.map((l) => (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/30 hover:text-[var(--accent)] transition-colors"
          >
            {l.label}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
        ))}
      </div>
    </div>
  );
};

// Responsive column count, mirrored from the Tailwind breakpoints below so the
// JS row-chunking and the rendered grid always agree.
function useColumns(): number {
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const compute = () => setCols(window.innerWidth >= 1024 ? 3 : window.innerWidth >= 640 ? 2 : 1);
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);
  return cols;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function DataServicesPage() {
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const columns = useColumns();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const stats = useMemo(() => catalogueStats(), []);

  const byTier = useMemo(() => {
    const map = new Map<ServiceTier, DataService[]>();
    for (const t of TIERS) map.set(t.tier, []);
    for (const s of DATA_SERVICES) map.get(s.tier)?.push(s);
    return map;
  }, []);

  // Nudge a freshly-opened panel into view if it landed below the fold.
  useEffect(() => {
    if (expandedSlug && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [expandedSlug]);

  const toggle = (slug: string) => setExpandedSlug((cur) => (cur === slug ? null : slug));

  return (
    <div className="space-y-6">
      <div className="pb-2 border-b border-[var(--border)]">
        <h1 className="text-2xl font-semibold text-[var(--text)]">Data Services</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          The catalogue of data services on Graph Horizon — every service follows the same TAP v2 / GraphTally payment
          pattern. The signal that matters most is whether anyone is actually serving paid queries.
        </p>
      </div>

      <StatGrid className="lg:grid-cols-3 xl:grid-cols-3">
        <StatCard label="Services tracked" value={String(stats.total)} subtitle="across 4 maturity tiers" />
        <StatCard label="Live on Arbitrum One" value={String(stats.mainnetLive)} subtitle="Subgraph · Seahorn · Dispatch" />
        <StatCard
          label="With active providers"
          value={String(stats.activeProviders)}
          subtitle="Subgraph Service only"
          tooltip="Only the Subgraph Service has a substantial active indexer set serving paid queries. Every other service has zero active providers."
        />
      </StatGrid>

      {TIERS.map((tier) => {
        const services = byTier.get(tier.tier) ?? [];
        if (services.length === 0) return null;
        const rows = chunk(services, columns);

        return (
          <section key={tier.tier} className="space-y-3">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h2 className="text-sm font-semibold text-[var(--text)]">
                <span className="font-mono text-[var(--text-faint)] mr-2">Tier {tier.tier}</span>
                {tier.label}
              </h2>
              <span className="text-xs text-[var(--text-faint)]">{tier.blurb}</span>
            </div>

            <div className="space-y-4">
              {rows.map((rowItems, rowIdx) => {
                const expandedInRow = rowItems.findIndex((s) => s.slug === expandedSlug);
                const open = expandedInRow !== -1;
                const expandedService = open ? rowItems[expandedInRow] : null;

                return (
                  <div key={rowIdx}>
                    <div
                      className="grid gap-4"
                      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                    >
                      {rowItems.map((service) => (
                        <ServiceCard
                          key={service.slug}
                          service={service}
                          expanded={service.slug === expandedSlug}
                          onToggle={() => toggle(service.slug)}
                        />
                      ))}
                    </div>

                    {/* Smooth height reveal via the 0fr → 1fr grid-rows trick. */}
                    <div
                      className="grid transition-[grid-template-rows] duration-300 ease-out"
                      style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
                    >
                      <div className="overflow-hidden">
                        {expandedService && (
                          <DetailPanel
                            service={expandedService}
                            columns={columns}
                            colIndex={expandedInRow}
                            onClose={() => setExpandedSlug(null)}
                            innerRef={panelRef}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="text-xs text-center text-[var(--text-faint)]">
        Curated research · reviewed {DATA_SERVICES_LAST_REVIEWED} · provider counts and addresses are point-in-time
        snapshots — verify on-chain before relying on them.
      </p>
    </div>
  );
}
