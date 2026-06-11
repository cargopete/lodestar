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
import type { DisassemblyDiff, HandlerDiffEntry, HandlerStatus } from '@/lib/disassembly/diff';

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

type Mode = 'inspect' | 'compare';

export default function DisassemblyPage() {
  const [mode, setMode] = useState<Mode>('inspect');

  // Deep-link: ?id=Qm… opens Inspect; ?a=Qm…&b=Qm… opens Compare.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mode select from URL params — intentional
    if (p.get('a') && p.get('b')) setMode('compare');
  }, []);

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

      <div className="inline-flex rounded-[var(--radius-button)] border-[0.5px] border-[var(--border)] p-0.5 bg-[var(--bg-surface)]">
        {(['inspect', 'compare'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1 rounded-[calc(var(--radius-button)-2px)] text-sm transition-colors ${
              mode === m ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {m === 'inspect' ? 'Inspect' : 'Compare versions'}
          </button>
        ))}
      </div>

      {mode === 'inspect' ? <InspectPanel /> : <ComparePanel />}
    </div>
  );
}

function InspectPanel() {
  const [input, setInput] = useState('');
  const [target, setTarget] = useState('');

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydrate from URL deep-link — intentional
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
    <>
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
    </>
  );
}

interface DiffApiResponse {
  data?: { diff: DisassemblyDiff; base: DisassemblyReport; target: DisassemblyReport };
  error?: string;
}

function ComparePanel() {
  const [inputA, setInputA] = useState('');
  const [inputB, setInputB] = useState('');
  const [pair, setPair] = useState<{ a: string; b: string } | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const a = p.get('a');
    const b = p.get('b');
    if (a && b) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydrate from URL deep-link — intentional
      setInputA(a);
      setInputB(b);
      setPair({ a, b });
    }
  }, []);

  const { data, isFetching, error } = useQuery<DiffApiResponse['data']>({
    queryKey: ['disassembly-diff', pair?.a, pair?.b],
    enabled: !!pair,
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const r = await fetch(`/api/disassembly/diff?a=${encodeURIComponent(pair!.a)}&b=${encodeURIComponent(pair!.b)}`);
      const json: DiffApiResponse = await r.json();
      if (!r.ok || !json.data) throw new Error(json.error ?? 'Failed to compare subgraphs');
      return json.data;
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const a = inputA.trim();
    const b = inputB.trim();
    if (a && b) setPair({ a, b });
  };

  return (
    <>
      <form onSubmit={submit} className="space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide">Base (older)</span>
            <input
              value={inputA}
              onChange={(e) => setInputA(e.target.value)}
              placeholder="Deployment ID A (Qm…)"
              spellCheck={false}
              className="px-3 py-2 rounded-[var(--radius-button)] bg-[var(--bg-surface)] border-[0.5px] border-[var(--border)] text-[var(--text)] text-sm font-mono placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-mid)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide">Target (newer)</span>
            <input
              value={inputB}
              onChange={(e) => setInputB(e.target.value)}
              placeholder="Deployment ID B (Qm…)"
              spellCheck={false}
              className="px-3 py-2 rounded-[var(--radius-button)] bg-[var(--bg-surface)] border-[0.5px] border-[var(--border)] text-[var(--text)] text-sm font-mono placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-mid)]"
            />
          </label>
        </div>
        <button
          type="submit"
          className="px-4 py-2 rounded-[var(--radius-button)] bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          disabled={!inputA.trim() || !inputB.trim() || isFetching}
        >
          {isFetching ? 'Comparing…' : 'Compare'}
        </button>
      </form>

      {error && (
        <Card className="border-[var(--red-dim)]">
          <p className="text-sm text-[var(--red)] font-mono">{(error as Error).message}</p>
        </Card>
      )}

      {!pair && !error && (
        <Card>
          <p className="text-sm text-[var(--text-muted)]">
            Paste two deployment IDs of the <em>same</em> subgraph — an older <span className="font-mono text-[var(--text)]">Base</span> and a
            newer <span className="font-mono text-[var(--text)]">Target</span> — to see exactly what changed between versions: handlers added or
            removed, handlers that gained or lost an <span className="font-mono text-[var(--text)]">eth_call</span>/IPFS reach, and how the
            transparency scorecard moved.
          </p>
        </Card>
      )}

      {data && <DiffReport diff={data.diff} />}
    </>
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

// ── Cross-version diff (Phase 1.5a) ──────────────────────────────────────────

const HANDLER_STATUS_META: Record<HandlerStatus, { label: string; color: string; symbol: string }> = {
  changed: { label: 'changed', color: 'var(--amber)', symbol: '~' },
  added: { label: 'added', color: 'var(--green)', symbol: '+' },
  removed: { label: 'removed', color: 'var(--red)', symbol: '−' },
  unchanged: { label: 'unchanged', color: 'var(--text-faint)', symbol: '=' },
};

function DiffReport({ diff }: { diff: DisassemblyDiff }) {
  const { scorecard, manifest, summary, hostSurface, handlers, dataSources, strings } = diff;
  const riskUp = scorecard.riskDelta > 0;
  const riskColor = scorecard.riskDelta === 0 ? 'var(--text-muted)' : riskUp ? 'var(--red)' : 'var(--green)';
  const changedHandlers = handlers.filter((h) => h.status !== 'unchanged');

  return (
    <div className="space-y-6">
      {diff.identical && (
        <Card className="border-[var(--green-dim)]">
          <p className="text-sm text-[var(--green)]">
            No material differences — same handlers, same reachable host APIs, same risk surface. (Recovered
            strings may still differ; see below.)
          </p>
        </Card>
      )}

      {/* Summary */}
      <StatGrid>
        <StatCard label="Handlers Added" value={String(summary.handlersAdded)} subtitle="present only in Target" />
        <StatCard label="Handlers Removed" value={String(summary.handlersRemoved)} subtitle="present only in Base" />
        <StatCard label="Handlers Changed" value={String(summary.handlersChanged)} subtitle="host-API reach moved" />
        <StatCard label="Unchanged" value={String(summary.handlersUnchanged)} subtitle="identical reachability" />
      </StatGrid>

      {/* Scorecard movement */}
      <Card>
        <CardHeader><CardTitle>Scorecard</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-3xl font-bold font-mono" style={{ color: GRADE_COLOR[scorecard.gradeFrom] }}>{scorecard.gradeFrom}</span>
              <span className="text-[var(--text-faint)]">→</span>
              <span className="text-3xl font-bold font-mono" style={{ color: GRADE_COLOR[scorecard.gradeTo] }}>{scorecard.gradeTo}</span>
              <span className="text-[11px] text-[var(--text-muted)] ml-1 uppercase tracking-wide">grade</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-sm text-[var(--text-muted)]">{scorecard.riskFrom} → {scorecard.riskTo}</span>
              <span className="font-mono text-sm font-semibold" style={{ color: riskColor }}>
                ({scorecard.riskDelta >= 0 ? '+' : ''}{scorecard.riskDelta})
              </span>
              <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide">risk</span>
            </div>
          </div>
          {(scorecard.flagsAdded.length > 0 || scorecard.flagsRemoved.length > 0) && (
            <div className="mt-3 space-y-2">
              {scorecard.flagsAdded.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-[var(--green)] font-medium">＋ new flags</span>
                  {scorecard.flagsAdded.map((f, i) => <Badge key={i} variant={FLAG_VARIANT[f.level]} title={f.detail}>{f.title}</Badge>)}
                </div>
              )}
              {scorecard.flagsRemoved.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-[var(--text-muted)] font-medium">− cleared</span>
                  {scorecard.flagsRemoved.map((f, i) => <Badge key={i} title={f.detail}>{f.title}</Badge>)}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manifest + host-surface deltas */}
      <Card>
        <CardHeader><CardTitle>Manifest &amp; host surface</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6 text-sm">
          <DiffRow label="apiVersion" from={manifest.apiVersionsFrom.join(', ')} to={manifest.apiVersionsTo.join(', ')} changed={manifest.apiVersionChanged} />
          <DiffRow label="specVersion" from={manifest.specFrom} to={manifest.specTo} changed={manifest.specFrom !== manifest.specTo} />
          <DiffRow label="Network" from={manifest.networkFrom} to={manifest.networkTo} changed={manifest.networkChanged} />
          <DiffRow
            label="Graft"
            from={manifest.graftFrom ? `${short(manifest.graftFrom.base)} @ ${manifest.graftFrom.block.toLocaleString()}` : 'none'}
            to={manifest.graftTo ? `${short(manifest.graftTo.base)} @ ${manifest.graftTo.block.toLocaleString()}` : 'none'}
            changed={JSON.stringify(manifest.graftFrom) !== JSON.stringify(manifest.graftTo)}
          />
          <div className="sm:col-span-2 flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[var(--text-muted)] text-[12px] mr-1">Host APIs:</span>
            {hostSurface.added.length === 0 && hostSurface.removed.length === 0 && (
              <span className="text-[12px] text-[var(--text-faint)]">unchanged</span>
            )}
            {hostSurface.added.map((c) => (
              <Badge key={`+${c}`} variant="success">+ {CATEGORY_META[c].label}</Badge>
            ))}
            {hostSurface.removed.map((c) => (
              <Badge key={`-${c}`} variant="default">− {CATEGORY_META[c].label}</Badge>
            ))}
          </div>
          {manifest.featuresAdded.concat(manifest.featuresRemoved).length > 0 && (
            <div className="sm:col-span-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[var(--text-muted)] text-[12px] mr-1">Features:</span>
              {manifest.featuresAdded.map((f) => <Badge key={`+${f}`} variant="success">+ {f}</Badge>)}
              {manifest.featuresRemoved.map((f) => <Badge key={`-${f}`} variant="default">− {f}</Badge>)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data source add/remove (only when something moved) */}
      {dataSources.some((d) => d.status !== 'common') && (
        <Card>
          <CardHeader><CardTitle>Data sources</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {dataSources.map((d) => (
              <Badge key={d.name} variant={d.status === 'added' ? 'success' : d.status === 'removed' ? 'error' : 'default'}>
                {d.status === 'added' ? '+ ' : d.status === 'removed' ? '− ' : ''}{d.name}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Handler diff */}
      <Card>
        <CardHeader><CardTitle>Handlers ({changedHandlers.length} changed/added/removed)</CardTitle></CardHeader>
        <CardContent>
          {changedHandlers.length === 0 ? (
            <p className="text-[12px] text-[var(--text-faint)]">No handler-level differences.</p>
          ) : (
            <HandlerDiffTable rows={changedHandlers} />
          )}
          {summary.handlersUnchanged > 0 && (
            <div className="mt-3">
              <Collapsible label={`Unchanged handlers (${summary.handlersUnchanged})`}>
                <HandlerDiffTable rows={handlers.filter((h) => h.status === 'unchanged')} />
              </Collapsible>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recovered strings */}
      {(strings.added.length > 0 || strings.removed.length > 0) && (
        <Card>
          <CardHeader><CardTitle>Recovered strings</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StringColumn title={`Added (${strings.added.length})`} items={strings.added} color="var(--green)" />
            <StringColumn title={`Removed (${strings.removed.length})`} items={strings.removed} color="var(--red)" />
            {strings.truncated && (
              <p className="sm:col-span-2 text-[11px] text-[var(--text-faint)]">Lists capped for display; some entries omitted.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DiffRow({ label, from, to, changed }: { label: string; from: string; to: string; changed: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--border)]/40 pb-1">
      <span className="text-[var(--text-muted)] text-[12px]">{label}</span>
      {changed ? (
        <span className="text-[12px] text-right font-mono">
          <span className="text-[var(--text-faint)]">{from}</span>
          <span className="text-[var(--text-faint)] mx-1">→</span>
          <span className="text-[var(--amber)]">{to}</span>
        </span>
      ) : (
        <span className="text-[var(--text)] text-[12px] text-right font-mono truncate" title={to}>{to}</span>
      )}
    </div>
  );
}

function HandlerDiffTable({ rows }: { rows: HandlerDiffEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[var(--text-muted)] text-left">
            <th className="font-medium py-1 pr-3">Handler</th>
            <th className="font-medium py-1 pr-3">Data source</th>
            <th className="font-medium py-1 pr-3">Status</th>
            <th className="font-medium py-1">Host-API delta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => {
            const meta = HANDLER_STATUS_META[h.status];
            return (
              <tr key={h.key} className="border-t border-[var(--border)]/40 align-top">
                <td className="py-1.5 pr-3 font-mono text-[var(--text)]">{h.handler}</td>
                <td className="py-1.5 pr-3 text-[var(--text-muted)] font-mono">{h.dataSource}</td>
                <td className="py-1.5 pr-3 font-mono font-semibold" style={{ color: meta.color }}>
                  {meta.symbol} {meta.label}
                </td>
                <td className="py-1.5">
                  {h.categoriesAdded.length === 0 && h.categoriesRemoved.length === 0 && !h.resolvedChanged ? (
                    <span className="text-[var(--text-faint)]">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-1 items-center">
                      {h.categoriesAdded.map((c) => (
                        <span key={`+${c}`} className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background: 'var(--green-dim)', color: 'var(--green)' }}>+ {CATEGORY_META[c].label}</span>
                      ))}
                      {h.categoriesRemoved.map((c) => (
                        <span key={`-${c}`} className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background: 'var(--red-dim)', color: 'var(--red)' }}>− {CATEGORY_META[c].label}</span>
                      ))}
                      {h.resolvedChanged && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background: 'var(--bg-elevated)', color: 'var(--amber)' }} title="Whether the handler resolved as a WASM export">
                          resolved {String(h.resolvedChanged.from)}→{String(h.resolvedChanged.to)}
                        </span>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StringColumn({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium mb-1" style={{ color }}>{title}</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-[var(--text-faint)]">none</p>
      ) : (
        <div className="max-h-56 overflow-y-auto font-mono text-[11px] text-[var(--text-muted)] space-y-0.5">
          {items.map((s, i) => <div key={i} className="truncate" title={s}>{s}</div>)}
        </div>
      )}
    </div>
  );
}
