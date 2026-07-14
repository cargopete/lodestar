'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { formatGRT, weiToGRT } from '@/lib/utils';
import type {
  DataSourceReport,
  DecodeAudit,
  DecodeFinding,
  DisassemblyReport,
  FlagLevel,
  HandlerAnalysis,
  HostCategory,
  SignalContext,
  SignalExposure,
} from '@/lib/disassembly/types';
import type { DisassemblyDiff, HandlerDiffEntry, HandlerStatus } from '@/lib/disassembly/diff';
import { riskPriority, worstFlagLevel, type RiskPriority } from '@/lib/disassembly/signal';
import type { VerifyComparison, ModuleComparison, ModuleStatus, OverallVerdict } from '@/lib/disassembly/verify';

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

const FLAG_RANK: Record<FlagLevel, number> = { critical: 0, warn: 1, info: 2 };

const PRIORITY_META: Record<RiskPriority, { label: string; variant: 'default' | 'success' | 'warning' | 'error'; color: string }> = {
  low: { label: 'Low priority', variant: 'success', color: 'var(--green)' },
  medium: { label: 'Medium priority', variant: 'warning', color: 'var(--amber)' },
  high: { label: 'High priority', variant: 'error', color: 'var(--red)' },
  critical: { label: 'Critical priority', variant: 'error', color: 'var(--red)' },
};

const EXPOSURE_LABEL: Record<SignalExposure, string> = {
  none: 'no signal',
  low: 'low exposure',
  medium: 'medium exposure',
  high: 'high exposure',
};

// graph-node issues documenting the ethereum.decode alloy-migration breakage.
const DECODE_ISSUE_6683 = 'https://github.com/graphprotocol/graph-node/issues/6683';
const DECODE_ISSUE_6461 = 'https://github.com/graphprotocol/graph-node/issues/6461';

/** Minimal slice of /api/indexing-status used to label silent vs loud failure. */
interface DeploymentHealth {
  totalIndexers: number;
  syncedCount: number;
  healthyCount: number;
  failedCount: number;
  unreachableCount: number;
}

// The Graph's own GNS / network subgraph — 6 data sources, reads IPFS metadata.
const SAMPLE_ID = 'QmQKXcNQQRdUvNRMGJiE2idoTu9fo5F5MRtKztH4WyKxED';

function short(hash: string, head = 8, tail = 6): string {
  return hash.length > head + tail + 1 ? `${hash.slice(0, head)}…${hash.slice(-tail)}` : hash;
}

const VERIFY_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'];

/** Normalise a metadata codeRepository into a verifiable https git URL, or undefined. */
function normalizeRepo(url?: string | null): string | undefined {
  if (!url || !url.trim()) return undefined;
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, '')}`;
  try {
    const host = new URL(u).hostname.replace(/^www\./, '');
    return VERIFY_HOSTS.includes(host) ? u.replace(/^http:\/\//i, 'https://') : undefined;
  } catch {
    return undefined;
  }
}

interface ApiResponse {
  data?: DisassemblyReport;
  error?: string;
}

type Mode = 'inspect' | 'compare';

const MODE_LABEL: Record<Mode, string> = {
  inspect: 'Inspect',
  compare: 'Compare versions',
};

export function DisassemblyClient({ initialId }: { initialId?: string }) {
  const [mode, setMode] = useState<Mode>('inspect');

  // Deep-link: ?id=Qm… opens Inspect; ?a=Qm…&b=Qm… opens Compare. Skipped when an
  // initialId is supplied by the canonical /disassembly/[id] route.
  useEffect(() => {
    if (initialId) return;
    const p = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mode select from URL params — intentional
    if (p.get('a') && p.get('b')) setMode('compare');
  }, [initialId]);

  return (
    <div className="space-y-6">
      <div
        className="flex items-center gap-2 rounded-[var(--radius-card)] border px-3 py-2 text-[12px]"
        style={{
          borderColor: 'var(--amber)',
          background: 'color-mix(in srgb, var(--amber) 10%, var(--bg-surface))',
          color: 'var(--amber)',
        }}
      >
        <span aria-hidden>⚗️</span>
        <span>
          <strong>Experimental.</strong> Subgraph Disassembly is under active development — results may be
          incomplete and the feature may change.
        </span>
      </div>

      <header className="pb-2 border-b border-[var(--border)]">
        <h1 className="text-2xl font-semibold text-[var(--text)]">Subgraph Disassembly</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1 max-w-3xl">
          Fetch a deployed subgraph&apos;s compiled WASM straight from IPFS and statically disassemble it — which
          host APIs each handler can reach, recovered strings and names, and a transparency scorecard. No build,
          no execution.
        </p>
      </header>

      <div className="inline-flex rounded-[var(--radius-button)] border-[0.5px] border-[var(--border)] p-0.5 bg-[var(--bg-surface)]">
        {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1 rounded-[calc(var(--radius-button)-2px)] text-sm transition-colors ${
              mode === m ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {mode === 'inspect' && <InspectPanel initialId={initialId} />}
      {mode === 'compare' && <ComparePanel />}
    </div>
  );
}

interface SubgraphSearchResult {
  id: string;
  metadata: { displayName: string; description: string | null } | null;
  currentVersion: { subgraphDeployment: { ipfsHash: string; signalledTokens: string; stakedTokens: string } } | null;
}

const QM_HASH_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;

// A searchable subgraph picker: type a name to get a dropdown of matches (by
// signal), or paste a deployment hash directly. Selecting one disassembles it.
function SubgraphPicker({
  value,
  onChange,
  onPick,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (ipfsHash: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value.trim()), 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value]);

  const isFullHash = QM_HASH_RE.test(value.trim());

  const { data: results, isFetching } = useQuery<SubgraphSearchResult[]>({
    queryKey: ['subgraph-search', debounced],
    enabled: debounced.length >= 2 && !QM_HASH_RE.test(debounced),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const r = await fetch(`/api/subgraph-search?q=${encodeURIComponent(debounced)}`);
      const json: { data?: SubgraphSearchResult[] } = await r.json();
      return json.data ?? [];
    },
  });

  const hits = (results ?? []).filter((s) => s.currentVersion?.subgraphDeployment?.ipfsHash).slice(0, 12);
  const show = open && !isFullHash && debounced.length >= 2;

  return (
    <div className="relative flex-1">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search a subgraph by name, or paste a deployment ID (Qm…)"
        spellCheck={false}
        className="w-full px-3 py-2 rounded-[var(--radius-button)] bg-[var(--bg-surface)] border-[0.5px] border-[var(--border)] text-[var(--text)] text-sm font-mono placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-mid)]"
      />
      {show && (
        <ul className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-[var(--radius-card)] border-[0.5px] border-[var(--border)] bg-[var(--bg-surface)] shadow-lg">
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-[var(--text-faint)]">{isFetching ? 'Searching…' : 'No subgraphs found'}</li>
          ) : (
            hits.map((s) => {
              const hash = s.currentVersion!.subgraphDeployment.ipfsHash;
              const name = s.metadata?.displayName || 'Unnamed subgraph';
              const signal = formatGRT(weiToGRT(s.currentVersion!.subgraphDeployment.signalledTokens || '0'));
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { onPick(hash); setOpen(false); }}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--bg-elevated)] transition-colors flex items-center justify-between gap-3"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm text-[var(--text)] truncate">{name}</span>
                      <span className="block text-[11px] font-mono text-[var(--text-faint)] truncate">{short(hash)}</span>
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)] shrink-0">{signal} GRT</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

function InspectPanel({ initialId }: { initialId?: string }) {
  const [input, setInput] = useState(initialId ?? '');
  const [target, setTarget] = useState(initialId ?? '');

  useEffect(() => {
    if (initialId) return; // seeded from the canonical route — don't re-read the URL
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydrate from URL deep-link — intentional
      setInput(id);
      setTarget(id);
    }
  }, [initialId]);

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
        <SubgraphPicker
          value={input}
          onChange={setInput}
          onPick={(hash) => { setInput(hash); setTarget(hash); }}
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
            Search for a subgraph by name and pick it from the list — or paste a deployment ID (the
            <span className="font-mono text-[var(--text)]"> Qm… </span>hash) directly. The deployment ID <em>is</em> the
            IPFS hash of the manifest, so the compiled mapping modules are fetched and disassembled directly — no
            source repository required.
          </p>
        </Card>
      )}

      {data && <ShareLink id={target} />}
      {data && <Report report={data} />}
      {data && <SourceVerification key={target} deploymentId={target} defaultRepoUrl={normalizeRepo(data.sourceHint?.codeRepository)} />}
    </>
  );
}

function ShareLink({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const href = `/disassembly/${id}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${href}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the link is still visible below */
    }
  };

  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="text-[var(--text-muted)]">Shareable link:</span>
      <a href={href} className="font-mono text-[var(--accent)] hover:underline truncate">{href}</a>
      <button
        type="button"
        onClick={copy}
        className="px-2 py-0.5 rounded-[var(--radius-button)] bg-[var(--bg-surface)] border-[0.5px] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors shrink-0"
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
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

      {data && <DiffReport diff={data.diff} baseSignal={data.base.signal} targetSignal={data.target.signal} />}
    </>
  );
}

// ── Source verification (Phase 2) ────────────────────────────────────────────

type Verdict = OverallVerdict | 'unbuildable';

interface VerifyData {
  verdict: Verdict;
  comparison: VerifyComparison | null;
  build: { log: string; durationMs: number; moduleCount?: number; error?: string };
}
interface VerifyApiResponse {
  data?: VerifyData;
  error?: string;
}

const VERDICT_META: Record<Verdict, { label: string; color: string; borderClass: string; blurb: string }> = {
  'verified-exact': {
    label: '✓ Verified — byte-identical',
    color: 'var(--green)',
    borderClass: 'border-[var(--green-dim)]',
    blurb: 'Every deployed module is byte-for-byte the build of this source. The strongest possible proof.',
  },
  'verified-structural': {
    label: '✓ Verified — structural match',
    color: 'var(--green)',
    borderClass: 'border-[var(--green-dim)]',
    blurb: 'Bytes differ (build-toolchain noise) but every module exposes an identical reachable host-API surface.',
  },
  diverged: {
    label: '✗ Diverged',
    color: 'var(--red)',
    borderClass: 'border-[var(--red-dim)]',
    blurb: 'The deployed WASM differs from this source in ways that change which host APIs are reachable — or a module is missing on one side.',
  },
  unbuildable: {
    label: '⚠ Unbuildable',
    color: 'var(--amber)',
    borderClass: 'border-[var(--amber)]',
    blurb: 'The source could not be built in the sandbox. See the build log below.',
  },
};

const MODULE_STATUS_META: Record<ModuleStatus, { label: string; color: string }> = {
  exact: { label: 'byte-exact', color: 'var(--green)' },
  structural: { label: 'structural', color: 'var(--green)' },
  diverged: { label: 'diverged', color: 'var(--red)' },
  'only-built': { label: 'only in source', color: 'var(--amber)' },
  'only-deployed': { label: 'only deployed', color: 'var(--amber)' },
};

// Optional source verification, folded into the Inspect view. The deployed WASM
// is already in hand (fetched from the Qm hash); supplying a repo only adds the
// "does this match the public source?" check, so it lives behind a disclosure.
function SourceVerification({ deploymentId, defaultRepoUrl }: { deploymentId: string; defaultRepoUrl?: string }) {
  const [repoUrl, setRepoUrl] = useState(defaultRepoUrl ?? '');
  const [ref, setRef] = useState('');
  const [manifestPath, setManifestPath] = useState('');
  const [prepareCommand, setPrepareCommand] = useState('');

  const { mutate, data, error, isPending } = useMutation<VerifyData, Error>({
    mutationFn: async () => {
      const r = await fetch('/api/disassembly/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deploymentId,
          repoUrl: repoUrl.trim(),
          ref: ref.trim() || undefined,
          manifestPath: manifestPath.trim() || undefined,
          prepareCommand: prepareCommand.trim() || undefined,
        }),
      });
      const json: VerifyApiResponse = await r.json();
      if (!r.ok || !json.data) throw new Error(json.error ?? 'Verification failed');
      return json.data;
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (repoUrl.trim() && !isPending) mutate();
  };

  const inputCls =
    'px-3 py-2 rounded-[var(--radius-button)] bg-[var(--bg-surface)] border-[0.5px] border-[var(--border)] text-[var(--text)] text-sm font-mono placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-mid)]';

  return (
    <Card>
      <details>
        <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
          <span className="font-semibold text-[var(--text)] text-sm">Verify against source <span className="text-[var(--text-faint)] font-normal">(optional)</span></span>
          {defaultRepoUrl ? (
            <Badge variant="success">repo auto-resolved</Badge>
          ) : (
            <span className="text-[11px] text-[var(--text-muted)]">does the deployed WASM match the public repo?</span>
          )}
        </summary>

        <div className="mt-3 space-y-3">
          <p className="text-[12px] text-[var(--text-muted)]">
            The deployed WASM above came straight from the deployment hash. To check it against its source, point us at
            the public repo — we build it in an ephemeral sandbox and compare the produced WASM byte-for-byte.
          </p>

          <form onSubmit={submit} className="space-y-2">
            <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="Source repo URL (https://github.com/org/repo)" spellCheck={false} className={`w-full ${inputCls}`} />
            {defaultRepoUrl && repoUrl === defaultRepoUrl && (
              <p className="text-[11px] text-[var(--green)]">↪ auto-resolved from the subgraph&apos;s on-chain metadata — edit if needed.</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Ref — branch / tag / commit (optional)" spellCheck={false} className={inputCls} />
              <input value={manifestPath} onChange={(e) => setManifestPath(e.target.value)} placeholder="Manifest path (default subgraph.yaml)" spellCheck={false} className={inputCls} />
            </div>
            <input value={prepareCommand} onChange={(e) => setPrepareCommand(e.target.value)} placeholder="Prepare command (advanced — e.g. yarn prepare:mainnet)" spellCheck={false} className={`w-full ${inputCls}`} />
            <button
              type="submit"
              className="px-4 py-2 rounded-[var(--radius-button)] bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              disabled={!repoUrl.trim() || isPending}
            >
              {isPending ? 'Building & verifying… (may take a few minutes)' : 'Verify against source'}
            </button>
            <p className="text-[11px] text-[var(--text-faint)]">
              Templated manifests are auto-generated via the repo&apos;s prepare script; for bespoke pipelines, set a
              custom prepare command. Public github.com / gitlab.com / bitbucket.org repos only.
            </p>
          </form>

          {error && (
            <Card className="border-[var(--red-dim)]">
              <p className="text-sm text-[var(--red)] font-mono">{error.message}</p>
            </Card>
          )}

          {data && <VerifyReport result={data} />}
        </div>
      </details>
    </Card>
  );
}

function VerifyReport({ result }: { result: VerifyData }) {
  const meta = VERDICT_META[result.verdict];
  const c = result.comparison;

  return (
    <div className="space-y-6">
      <Card className={meta.borderClass}>
        <div className="flex flex-col gap-1">
          <span className="text-lg font-semibold" style={{ color: meta.color }}>{meta.label}</span>
          <span className="text-sm text-[var(--text-muted)]">{meta.blurb}</span>
        </div>
      </Card>

      {c && (
        <>
          <StatGrid>
            <StatCard label="Byte-exact" value={String(c.summary.exact)} subtitle="identical modules" />
            <StatCard label="Structural" value={String(c.summary.structural)} subtitle="same host surface" />
            <StatCard label="Diverged" value={String(c.summary.diverged)} subtitle="behaviour differs" />
            <StatCard label="Modules" value={String(c.summary.total)} subtitle={`${result.build.moduleCount ?? c.summary.total} built`} />
          </StatGrid>

          <Card>
            <CardHeader><CardTitle>Per-module comparison</CardTitle></CardHeader>
            <CardContent>
              <ModuleTable modules={c.modules} />
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Build log</CardTitle>
            <span className="text-[11px] text-[var(--text-muted)]">{(result.build.durationMs / 1000).toFixed(1)}s</span>
          </div>
        </CardHeader>
        <CardContent>
          {result.build.error && <p className="text-[12px] text-[var(--red)] mb-2">{result.build.error}</p>}
          <pre className="max-h-80 overflow-auto text-[11px] font-mono text-[var(--text-muted)] whitespace-pre-wrap bg-[var(--bg-elevated)] rounded-[var(--radius-button)] p-3">
            {result.build.log || '(no output)'}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

function ModuleTable({ modules }: { modules: ModuleComparison[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[var(--text-muted)] text-left">
            <th className="font-medium py-1 pr-3">Data source</th>
            <th className="font-medium py-1 pr-3">Status</th>
            <th className="font-medium py-1 pr-3">Built</th>
            <th className="font-medium py-1 pr-3">Deployed</th>
            <th className="font-medium py-1">Host-API delta</th>
          </tr>
        </thead>
        <tbody>
          {modules.map((m) => {
            const sm = MODULE_STATUS_META[m.status];
            return (
              <tr key={m.name} className="border-t border-[var(--border)]/40 align-top">
                <td className="py-1.5 pr-3 font-mono text-[var(--text)]">{m.name}</td>
                <td className="py-1.5 pr-3 font-mono font-semibold" style={{ color: sm.color }}>{sm.label}</td>
                <td className="py-1.5 pr-3 font-mono text-[var(--text-faint)]">{m.builtBytes != null ? `${(m.builtBytes / 1024).toFixed(0)}KB` : '—'}</td>
                <td className="py-1.5 pr-3 font-mono text-[var(--text-faint)]">{m.deployedBytes != null ? `${(m.deployedBytes / 1024).toFixed(0)}KB` : '—'}</td>
                <td className="py-1.5">
                  {m.hostImportsAdded.length === 0 && m.hostImportsRemoved.length === 0 ? (
                    <span className="text-[var(--text-faint)]">{m.status === 'exact' || m.status === 'structural' ? '—' : 'n/a'}</span>
                  ) : (
                    <span className="flex flex-wrap gap-1 items-center">
                      {m.hostImportsAdded.map((h) => (
                        <span key={`+${h}`} className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background: 'var(--green-dim)', color: 'var(--green)' }}>+ {h}</span>
                      ))}
                      {m.hostImportsRemoved.map((h) => (
                        <span key={`-${h}`} className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background: 'var(--red-dim)', color: 'var(--red)' }}>− {h}</span>
                      ))}
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

function Report({ report }: { report: DisassemblyReport }) {
  const { scorecard, manifest, totals, dataSources, caveats, signal } = report;
  const sortedFlags = [...scorecard.flags].sort((a, b) => FLAG_RANK[a.level] - FLAG_RANK[b.level]);

  // Only when a decode divergence is found do we spend a call on live indexing
  // health — it's what tells silent data loss (indexers healthy) from a loud
  // deterministic failure. Lazy + gated so page load and clean deployments pay nothing.
  const hasDivergent = dataSources.some((d) => d.decodeAudit?.status === 'divergent');
  const { data: decodeHealth } = useQuery<DeploymentHealth | null>({
    queryKey: ['decode-health', report.deploymentId],
    enabled: hasDivergent,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/indexing-status/${report.deploymentId}`);
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: DeploymentHealth };
      return json.data ?? null;
    },
  });

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
            {sortedFlags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {sortedFlags.map((f, i) => (
                  <Badge key={i} variant={FLAG_VARIANT[f.level]} title={f.detail}>{f.title}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--green)]">No risk flags raised.</p>
            )}
          </div>
        </div>
      </Card>

      {/* Signal-weighted exposure (Phase 1.5b) */}
      <SignalExposureCard signal={signal} flagLevels={scorecard.flags.map((f) => f.level)} flagCount={scorecard.flags.filter((f) => f.level !== 'info').length} />

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
        {dataSources.map((ds, i) => <DataSourceBlock key={`${ds.name}-${i}`} ds={ds} health={decodeHealth} />)}
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

function SignalExposureCard({
  signal,
  flagLevels,
  flagCount,
}: {
  signal: SignalContext | null | undefined;
  flagLevels: FlagLevel[];
  flagCount: number;
}) {
  if (signal === null || signal === undefined) {
    return (
      <Card>
        <CardContent className="py-2">
          <p className="text-[12px] text-[var(--text-faint)]">
            Curation signal unavailable — risk flags can&apos;t be weighted by stake right now.
          </p>
        </CardContent>
      </Card>
    );
  }

  const priority = riskPriority(worstFlagLevel(flagLevels), signal.exposure);
  const pm = PRIORITY_META[priority];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Signal-weighted exposure</CardTitle>
          <Badge variant={pm.variant} title={`worst flag × ${EXPOSURE_LABEL[signal.exposure]}`}>{pm.label}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <StatGrid>
          <StatCard
            label="Signalled"
            value={`${formatGRT(signal.signalledGRT)} GRT`}
            subtitle={`${signal.curatorCount}${signal.curatorCountCapped ? '+' : ''} curator(s) · ${EXPOSURE_LABEL[signal.exposure]}`}
          />
          <StatCard label="Query Fees" value={`${formatGRT(signal.queryFeesGRT)} GRT`} subtitle="cumulative on deployment" />
          <StatCard label="Risk Flags" value={String(flagCount)} subtitle="warn + critical" />
        </StatGrid>
        {flagCount > 0 && signal.signalledGRT > 0 ? (
          <p className="text-[12px] mt-3" style={{ color: pm.color }}>
            {formatGRT(signal.signalledGRT)} GRT signalled is exposed to {flagCount} risk flag{flagCount === 1 ? '' : 's'}.
          </p>
        ) : flagCount === 0 ? (
          <p className="text-[12px] text-[var(--green)] mt-3">No warn/critical flags — nothing at stake here regardless of signal.</p>
        ) : null}
      </CardContent>
    </Card>
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

function DataSourceBlock({ ds, health }: { ds: DataSourceReport; health?: DeploymentHealth | null }) {
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

          {ds.decodeAudit && <DecodeAuditPanel audit={ds.decodeAudit} health={health} />}
        </div>
      </details>
    </Card>
  );
}

// ── ethereum.decode compatibility audit (graph-node 0.42 alloy migration) ─────

function DecodeAuditPanel({ audit, health }: { audit: DecodeAudit; health?: DeploymentHealth | null }) {
  const divergent = audit.status === 'divergent';

  // Collapsed by default when there's nothing wrong; forced open when divergent.
  return (
    <details
      open={divergent}
      className="rounded-[var(--radius-button)] px-3 py-2"
      style={{
        background: divergent ? 'color-mix(in srgb, var(--red) 8%, var(--bg-elevated))' : 'var(--bg-elevated)',
        border: divergent ? '1px solid color-mix(in srgb, var(--red) 40%, transparent)' : '1px solid transparent',
      }}
    >
      <summary className="cursor-pointer list-none flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
        <span className="flex items-center gap-2 min-w-0">
          <span className="truncate">Decode Compatibility Audit <span className="text-[var(--text-faint)]">(graph-node 0.42 alloy migration)</span></span>
        </span>
        {divergent ? (
          <Badge variant="error">{audit.findings.length} divergent</Badge>
        ) : audit.status === 'clean' ? (
          <Badge variant="success">clean</Badge>
        ) : audit.status === 'no-import' ? (
          <span className="text-[var(--text-faint)] shrink-0">no decode</span>
        ) : null}
      </summary>

      <div className="mt-2">
        {audit.unavailable ? (
          <p className="text-[12px] text-[var(--text-faint)]">
            Exact-parity ethabi/alloy classifier unavailable in this runtime — decode compatibility could not be evaluated.
          </p>
        ) : audit.status === 'no-import' ? (
          <p className="text-[12px] text-[var(--green)]">
            No <code className="font-mono">ethereum.decode</code> import — unaffected by the graph-node 0.42 alloy migration.
          </p>
        ) : audit.status === 'clean' ? (
          <p className="text-[12px] text-[var(--green)]">
            Uses <code className="font-mono">ethereum.decode</code>; all {audit.candidatesScanned} candidate type
            string{audit.candidatesScanned === 1 ? '' : 's'} still parse under alloy (graph-node ≥0.42).
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] text-[var(--red)]">
              {audit.findings.length} type string{audit.findings.length === 1 ? '' : 's'} that <strong>ethabi accepted (graph-node ≤0.41)</strong> but{' '}
              <strong>alloy rejects (≥0.42)</strong> — <code className="font-mono">ethereum.decode</code> returns <code className="font-mono">null</code> for these on modern graph-node.
            </p>

            <DecodeHealthNote health={health} />

            <div className="space-y-2">
              {audit.findings.map((f, i) => <DecodeFindingCard key={i} f={f} />)}
            </div>

            <p className="text-[11px] text-[var(--text-faint)] leading-relaxed">
              Static data-segment scan with no dataflow — a flagged string may not be the exact argument passed to{' '}
              <code className="font-mono">ethereum.decode</code>, and dynamically built type strings aren&apos;t detected.
              Background:{' '}
              <a href={DECODE_ISSUE_6683} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--text)]">#6683</a>
              {' · '}
              <a href={DECODE_ISSUE_6461} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--text)]">#6461</a>.
            </p>
          </div>
        )}
      </div>
    </details>
  );
}

function DecodeFindingCard({ f }: { f: DecodeFinding }) {
  return (
    <div className="rounded-[var(--radius-button)] bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 space-y-1">
      <div className="font-mono text-[12px] text-[var(--text)] break-all">
        <span
          className="px-1 py-0.5 rounded"
          style={{ background: 'color-mix(in srgb, var(--red) 14%, transparent)' }}
          title={`raw: ${JSON.stringify(f.raw)}`}
        >
          {f.display}
        </span>
      </div>
      <div className="text-[11px] text-[var(--text-muted)]">
        <span className="text-[var(--text-faint)]">ethabi (≤0.41): </span>
        <span className="font-mono">{f.ethabi}</span>
      </div>
      <div className="text-[11px] text-[var(--text-muted)]">
        <span className="text-[var(--text-faint)]">alloy (≥0.42): </span>
        <span className="font-mono text-[var(--red)]">rejected</span>
        <span className="text-[var(--text-faint)]"> — {f.alloyReason}</span>
      </div>
    </div>
  );
}

/** Silent-vs-loud annotation from live indexing health, when available. */
function DecodeHealthNote({ health }: { health?: DeploymentHealth | null }) {
  if (!health || health.totalIndexers === 0) return null;

  const alive = health.totalIndexers - health.unreachableCount;
  if (alive <= 0) return null;

  if (health.failedCount > 0) {
    return (
      <div
        className="text-[12px] rounded-[var(--radius-button)] px-2.5 py-1.5"
        style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}
      >
        <strong>Loud failure:</strong> {health.failedCount} of {alive} reporting indexer(s) are in a
        deterministic-failure state — consistent with a mapping that asserts on the decode result.
      </div>
    );
  }

  if (health.healthyCount > 0) {
    return (
      <div
        className="text-[12px] rounded-[var(--radius-button)] px-2.5 py-1.5"
        style={{ background: 'color-mix(in srgb, var(--amber) 12%, transparent)', color: 'var(--amber)' }}
      >
        <strong>Likely silent data loss:</strong> {health.healthyCount} of {alive} reporting indexer(s) are
        healthy/synced despite the divergent type string — if the mapping null-checks and early-returns, entities
        are being dropped and POIs diverging while the subgraph looks fine.
      </div>
    );
  }

  return null;
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

function DiffReport({
  diff,
  baseSignal,
  targetSignal,
}: {
  diff: DisassemblyDiff;
  baseSignal?: SignalContext | null;
  targetSignal?: SignalContext | null;
}) {
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
          {(baseSignal || targetSignal) && (
            <DiffRow
              label="Signalled GRT"
              from={baseSignal ? `${formatGRT(baseSignal.signalledGRT)} GRT` : '—'}
              to={targetSignal ? `${formatGRT(targetSignal.signalledGRT)} GRT` : '—'}
              changed={(baseSignal?.signalledGRT ?? -1) !== (targetSignal?.signalledGRT ?? -1)}
            />
          )}
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
