'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import type {
  DataSourceReport,
  DisassemblyReport,
  FlagLevel,
  HandlerAnalysis,
  HostCategory,
} from '@/lib/disassembly/types';

const CATEGORY_META: Record<HostCategory, { label: string; variant: 'default' | 'accent' | 'success' | 'warning' | 'error' }> = {
  store: { label: 'store', variant: 'default' },
  ethereum: { label: 'eth_call', variant: 'warning' },
  ipfs: { label: 'ipfs', variant: 'error' },
  json: { label: 'json', variant: 'default' },
  crypto: { label: 'crypto', variant: 'default' },
  bigInt: { label: 'bigInt', variant: 'default' },
  bigDecimal: { label: 'bigDecimal', variant: 'default' },
  typeConversion: { label: 'typeConv', variant: 'default' },
  dataSource: { label: 'dataSource', variant: 'warning' },
  log: { label: 'log', variant: 'default' },
  control: { label: 'control', variant: 'default' },
  other: { label: 'other', variant: 'default' },
};

const FLAG_VARIANT: Record<FlagLevel, 'default' | 'accent' | 'warning' | 'error'> = {
  info: 'accent',
  warn: 'warning',
  critical: 'error',
};

const GRADE_COLOR: Record<string, string> = {
  A: 'var(--green)',
  B: 'var(--green)',
  C: 'var(--amber)',
  D: 'var(--red)',
  F: 'var(--red)',
};

// The Graph's own GNS / network subgraph — 6 data sources, reads IPFS metadata.
const SAMPLE_ID = 'QmQKXcNQQRdUvNRMGJiE2idoTu9fo5F5MRtKztH4WyKxED';

function short(hash: string, head = 8, tail = 6): string {
  return hash.length > head + tail + 1 ? `${hash.slice(0, head)}…${hash.slice(-tail)}` : hash;
}

interface ApiResponse {
  data?: DisassemblyReport;
  error?: string;
}

export default function DisassemblyPage() {
  const [input, setInput] = useState('');
  const [target, setTarget] = useState('');

  // Deep-link support: ?id=Qm… (read client-side to avoid a Suspense boundary).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) {
      setInput(id);
      setTarget(id);
    }
  }, []);

  const { data, isFetching, error } = useQuery<DisassemblyReport>({
    queryKey: ['disassembly', target],
    enabled: target.length > 0,
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const r = await fetch(`/api/disassembly?id=${encodeURIComponent(target)}`);
      const json: ApiResponse = await r.json();
      if (!r.ok || !json.data) throw new Error(json.error ?? 'Failed to disassemble subgraph');
      return json.data;
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = input.trim();
    if (id) setTarget(id);
  };

  return (
    <div className="space-y-6">
      <header className="pb-2 border-b border-[var(--border)]">
        <h1 className="text-2xl font-semibold text-[var(--text)]">Subgraph Disassembly</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1 max-w-3xl">
          Fetch a deployed subgraph&apos;s compiled WASM straight from IPFS and statically disassemble it — which
          host APIs each handler can reach, recovered strings and names, and a transparency scorecard. No build,
          no execution.
        </p>
      </header>

      <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Deployment ID (Qm…)"
          spellCheck={false}
          className="flex-1 px-3 py-2 rounded-[var(--radius-button)] bg-[var(--bg-surface)] border-[0.5px] border-[var(--border)] text-[var(--text)] text-sm font-mono placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-mid)]"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            className="px-4 py-2 rounded-[var(--radius-button)] bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            disabled={!input.trim() || isFetching}
          >
            {isFetching ? 'Disassembling…' : 'Disassemble'}
          </button>
          <button
            type="button"
            onClick={() => { setInput(SAMPLE_ID); setTarget(SAMPLE_ID); }}
            className="px-3 py-2 rounded-[var(--radius-button)] bg-[var(--bg-surface)] border-[0.5px] border-[var(--border)] text-[var(--text-muted)] text-sm hover:text-[var(--text)] transition-colors"
          >
            Sample
          </button>
        </div>
      </form>

      {error && (
        <Card className="border-[var(--red-dim)]">
          <p className="text-sm text-[var(--red)] font-mono">{(error as Error).message}</p>
        </Card>
      )}

      {!target && !error && (
        <Card>
          <p className="text-sm text-[var(--text-muted)]">
            Paste a subgraph deployment ID (the <span className="font-mono text-[var(--text)]">Qm…</span> hash). The
            deployment ID <em>is</em> the IPFS hash of the manifest, so the compiled mapping modules are fetched and
            disassembled directly — no source repository required.
          </p>
        </Card>
      )}

      {data && <Report report={data} />}
    </div>
  );
}

function Report({ report }: { report: DisassemblyReport }) {
  const { scorecard, manifest, totals, dataSources, caveats } = report;

  return (
    <div className="space-y-6">
      {/* Scorecard */}
      <Card>
        <div className="flex items-start gap-5">
          <div className="flex flex-col items-center justify-center shrink-0 w-20">
            <span className="text-5xl font-bold font-mono leading-none" style={{ color: GRADE_COLOR[scorecard.grade] }}>
              {scorecard.grade}
            </span>
            <span className="text-[10px] text-[var(--text-muted)] mt-1 uppercase tracking-wide">risk {scorecard.riskScore}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              {scorecard.categories.map((c) => (
                <div key={c.name} className="rounded-[var(--radius-card)] bg-[var(--bg-elevated)] px-3 py-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] text-[var(--text-muted)]">{c.name}</span>
                    <span className="text-sm font-mono font-semibold text-[var(--text)]">{c.score}</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-faint)] mt-0.5 truncate" title={c.note}>{c.note}</p>
                </div>
              ))}
            </div>
            {scorecard.flags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {scorecard.flags.map((f, i) => (
                  <Badge key={i} variant={FLAG_VARIANT[f.level]} title={f.detail}>{f.title}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--green)]">No risk flags raised.</p>
            )}
          </div>
        </div>
      </Card>

      {/* Totals */}
      <StatGrid>
        <StatCard label="Data Sources" value={String(totals.dataSources)} subtitle={`${totals.templates} template(s)`} />
        <StatCard label="Handlers" value={String(totals.handlers)} subtitle={`${totals.resolvedHandlers} resolved in WASM`} />
        <StatCard label="Host APIs Used" value={String(totals.hostCategories.length)} subtitle={totals.hostCategories.join(', ') || 'none'} />
        <StatCard label="apiVersion" value={manifest.apiVersions.join(', ')} subtitle={`spec ${manifest.specVersion}`} />
        <StatCard label="WASM Size" value={`${(totals.wasmBytes / 1024).toFixed(0)} KB`} subtitle={manifest.network} />
      </StatGrid>

      {/* Manifest summary */}
      <Card>
        <CardHeader><CardTitle>Manifest</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6 text-sm">
          <Row label="Network" value={manifest.network} />
          <Row label="specVersion" value={manifest.specVersion} mono />
          <Row label="apiVersions" value={manifest.apiVersions.join(', ')} mono />
          <Row label="Schema" value={manifest.schemaHash ? short(manifest.schemaHash) : '—'} mono />
          <Row label="Features" value={manifest.features.length ? manifest.features.join(', ') : 'none'} />
          <Row label="Graft" value={manifest.graft ? `${short(manifest.graft.base)} @ ${manifest.graft.block.toLocaleString()}` : 'none'} mono />
        </CardContent>
      </Card>

      {/* Per data source */}
      <div className="space-y-3">
        {dataSources.map((ds, i) => <DataSourceBlock key={`${ds.name}-${i}`} ds={ds} />)}
      </div>

      {/* Caveats */}
      <Card className="border-[var(--border)]">
        <CardHeader><CardTitle>Caveats</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-[12px] text-[var(--text-muted)]">
            {caveats.map((c, i) => (
              <li key={i} className="flex gap-2"><span className="text-[var(--text-faint)]">•</span><span>{c}</span></li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--border)]/40 pb-1">
      <span className="text-[var(--text-muted)] text-[12px]">{label}</span>
      <span className={`text-[var(--text)] text-[12px] text-right truncate ${mono ? 'font-mono' : ''}`} title={value}>{value}</span>
    </div>
  );
}

function DataSourceBlock({ ds }: { ds: DataSourceReport }) {
  return (
    <Card>
      <details>
        <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-[var(--text)] text-sm truncate">{ds.name}</span>
            {ds.isTemplate && <Badge variant="accent">template</Badge>}
            <Badge>{ds.apiVersion}</Badge>
            {ds.wasm?.incomplete && <Badge variant="warning" title="Some bodies used opcodes outside the modelled set">partial decode</Badge>}
            {ds.error && <Badge variant="error" title={ds.error}>error</Badge>}
          </span>
          <span className="text-[11px] text-[var(--text-muted)] font-mono shrink-0">
            {ds.handlers.length} handler{ds.handlers.length === 1 ? '' : 's'}
          </span>
        </summary>

        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-[12px]">
            <Row label="Address" value={ds.address ? short(ds.address, 6, 4) : 'wildcard'} mono />
            <Row label="Start block" value={ds.startBlock.toLocaleString()} mono />
            <Row label="WASM" value={ds.wasmHash ? short(ds.wasmHash) : '—'} mono />
            <Row label="Size" value={ds.wasm ? `${(ds.wasm.byteSize / 1024).toFixed(0)} KB` : '—'} mono />
          </div>

          {ds.error ? (
            <p className="text-[12px] text-[var(--red)] font-mono">{ds.error}</p>
          ) : (
            <HandlerTable handlers={ds.handlers} />
          )}

          {ds.wasm && ds.wasm.hostImports.length > 0 && (
            <Collapsible label={`Host imports (${ds.wasm.hostImports.length})`}>
              <div className="flex flex-wrap gap-1.5">
                {ds.wasm.hostImports.map((h) => (
                  <Badge key={h.label} variant={CATEGORY_META[h.category].variant}>{h.label}</Badge>
                ))}
              </div>
            </Collapsible>
          )}

          {ds.wasm && ds.wasm.strings.length > 0 && (
            <Collapsible label={`Recovered strings (${ds.wasm.strings.length})`}>
              <div className="max-h-56 overflow-y-auto font-mono text-[11px] text-[var(--text-muted)] space-y-0.5">
                {ds.wasm.strings.map((s, i) => <div key={i} className="truncate">{s}</div>)}
              </div>
            </Collapsible>
          )}
        </div>
      </details>
    </Card>
  );
}

function HandlerTable({ handlers }: { handlers: HandlerAnalysis[] }) {
  if (handlers.length === 0) {
    return <p className="text-[12px] text-[var(--text-faint)]">No handlers declared.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[var(--text-muted)] text-left">
            <th className="font-medium py-1 pr-3">Handler</th>
            <th className="font-medium py-1 pr-3">Kind</th>
            <th className="font-medium py-1 pr-3">Trigger</th>
            <th className="font-medium py-1">Reachable host APIs</th>
          </tr>
        </thead>
        <tbody>
          {handlers.map((h, i) => (
            <tr key={`${h.handler}-${i}`} className="border-t border-[var(--border)]/40 align-top">
              <td className="py-1.5 pr-3 font-mono text-[var(--text)]">
                {h.handler}
                {!h.resolved && <span className="ml-1.5 text-[var(--amber)]" title="Not found as a WASM export">⚠</span>}
                {h.incomplete && <span className="ml-1.5 text-[var(--amber)]" title="Some reachable body used unmodelled opcodes — reachability may be partial">◐</span>}
              </td>
              <td className="py-1.5 pr-3 text-[var(--text-muted)]">{h.kind}</td>
              <td className="py-1.5 pr-3 font-mono text-[var(--text-faint)] max-w-[16rem] truncate" title={h.trigger ?? ''}>{h.trigger ?? '—'}</td>
              <td className="py-1.5">
                {h.categories.length === 0 ? (
                  <span className="text-[var(--text-faint)]">{h.resolved ? 'none' : '—'}</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {h.categories.map((c) => (
                      <Badge key={c} variant={CATEGORY_META[c].variant}>{CATEGORY_META[c].label}</Badge>
                    ))}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Collapsible({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="rounded-[var(--radius-button)] bg-[var(--bg-elevated)] px-3 py-2">
      <summary className="cursor-pointer list-none text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
        {label}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
