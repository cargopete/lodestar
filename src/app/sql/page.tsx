'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

// ── Types, mirroring /api/sql/catalog and /api/sql/query ─────────────────────

interface CatalogColumn {
  name: string;
  type: string;
  indexed: boolean;
}

interface CatalogTable {
  name: string;
  alias: string;
  event: string;
  columns: CatalogColumn[];
}

interface CatalogDataset {
  id: string;
  label: string;
  chain: string;
  description: string;
  sample: string;
  available: boolean;
  archival?: boolean;
  tableCount: number;
  tables: CatalogTable[];
  error?: string;
}

interface QueryResult {
  dataset: string;
  count: number;
  rows: Record<string, unknown>[];
  truncated: boolean;
  degraded: boolean;
  degradedTables: string[];
  tipUnavailable: boolean;
  provenance: {
    as_of?: number | null;
    sealed_through?: number | null;
    source?: string;
    registry_hash?: string | null;
    nid?: string | null;
  } | null;
}

// ── Cells ────────────────────────────────────────────────────────────────────

/** Long hex is the common case here, and an untruncated tx hash makes every column unreadable. */
function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-[var(--text-faint)] italic">null</span>;
  }
  const s = String(value);
  const isHex = /^0x[0-9a-f]{16,}$/i.test(s);
  return (
    <span className={cn(isHex && 'font-mono text-[11px]')} title={s.length > 24 ? s : undefined}>
      {isHex ? `${s.slice(0, 10)}…${s.slice(-6)}` : s}
    </span>
  );
}

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = useMemo(() => (rows.length ? Object.keys(rows[0]) : []), [rows]);
  if (!rows.length) {
    return (
      <p className="text-sm text-[var(--text-muted)] py-6 text-center">
        The query ran and matched nothing. That is an answer, not a failure.
      </p>
    );
  }
  return (
    // Wide result sets are normal; the page must not scroll sideways because of one.
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-[0.5px] border-[var(--border)]">
            {columns.map((c) => (
              <th
                key={c}
                className="text-left font-medium text-[var(--text-muted)] text-[11px] uppercase tracking-wide py-2 pr-4 whitespace-nowrap"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b-[0.5px] border-[var(--border)] last:border-0">
              {columns.map((c) => (
                <td key={c} className="py-2 pr-4 whitespace-nowrap align-top">
                  <Cell value={row[c]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SqlPage() {
  // Deliberately *not* a useEffect that picks a default and calls setState. That triggers a
  // cascading render (and a lint error saying so), and the state it sets is derivable: the chosen
  // dataset is whatever the reader clicked, else the first one that can actually answer. Same for
  // the editor contents, which are the dataset's sample until the reader types over it.
  const [chosen, setChosen] = useState<string | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [openTable, setOpenTable] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState('');

  const catalog = useQuery({
    queryKey: ['sql-catalog'],
    queryFn: async (): Promise<{ available: boolean; datasets: CatalogDataset[] }> => {
      const res = await fetch('/api/sql/catalog');
      if (!res.ok && res.status !== 503) throw new Error('catalog unavailable');
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const datasets = useMemo(() => catalog.data?.datasets ?? [], [catalog.data]);
  const dataset =
    datasets.find((d) => d.id === chosen) ?? datasets.find((d) => d.available) ?? datasets[0];
  const datasetId = dataset?.id ?? '';
  const sql = edited ?? dataset?.sample ?? '';
  const setSql = setEdited;

  const run = useCallback(async () => {
    if (!datasetId || !sql.trim()) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/sql/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset: datasetId, q: sql }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status}).`);
        setResult(null);
      } else {
        setResult(json as QueryResult);
      }
    } catch {
      setError('Could not reach the query API.');
      setResult(null);
    } finally {
      setRunning(false);
    }
  }, [datasetId, sql]);

  const visibleTables = useMemo(() => {
    if (!dataset) return [];
    const f = tableFilter.trim().toLowerCase();
    if (!f) return dataset.tables;
    return dataset.tables.filter(
      (t) => t.name.toLowerCase().includes(f) || t.event.toLowerCase().includes(f)
    );
  }, [dataset, tableFilter]);

  const unavailable = catalog.data?.available === false;

  return (
    <main className="max-w-[1200px] mx-auto px-4 py-8">
      <header className="mb-6">
        <h1
          className="text-2xl font-semibold text-[var(--text)] mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          SQL
        </h1>
        <p className="text-sm text-[var(--text-muted)] max-w-2xl">
          Query the indexed chain data behind this dashboard directly. These are{' '}
          <a
            href="https://github.com/nightswatchhq/nuthatch"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            nuthatch
          </a>{' '}
          nests we run: read-only, row-capped, and stamped with the block they were true as of. Free
          and unauthenticated, at five queries a minute with a six-second timeout, which suits
          exploring a dataset rather than depending on one.
        </p>
      </header>

      {unavailable && (
        <Card className="mb-6">
          <p className="text-sm text-[var(--text-muted)]">
            The SQL surface is not configured on this deployment.
          </p>
        </Card>
      )}

      {/* Dataset picker */}
      <div className="flex flex-wrap gap-2 mb-4">
        {datasets.map((d) => (
          <button
            key={d.id}
            onClick={() => {
              setChosen(d.id);
              setEdited(null);
              setResult(null);
              setError(null);
              setOpenTable(null);
              setTableFilter('');
            }}
            disabled={!d.available}
            className={cn(
              'px-3 py-1.5 rounded-[var(--radius-button)] text-sm border-[0.5px] transition-colors',
              d.id === datasetId
                ? 'bg-[var(--accent)] text-[var(--accent-text)] border-[var(--accent)]'
                : 'bg-[var(--bg-elevated)] text-[var(--text)] border-[var(--border)] hover:border-[var(--accent)]',
              !d.available && 'opacity-50 cursor-not-allowed'
            )}
          >
            {d.label}
            {!d.available && <span className="ml-1.5 text-[11px]">(down)</span>}
            {d.available && d.archival && <span className="ml-1.5 text-[11px]">(archive)</span>}
          </button>
        ))}
      </div>

      {dataset && (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          {/* Schema */}
          <Card className="h-fit lg:sticky lg:top-4">
            <div className="mb-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <h2 className="text-sm font-semibold text-[var(--text)]">Tables</h2>
                <Badge variant="default">{dataset.tableCount}</Badge>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                {dataset.description}
              </p>
              <p className="text-[11px] text-[var(--text-faint)] mt-1">{dataset.chain}</p>
              {dataset.archival && (
                <p className="text-[11px] text-[var(--amber)] mt-2 leading-relaxed">
                  Frozen archive. It answers from sealed history and does not follow the chain, so
                  recent blocks are not here. Pin your query and read the provenance stamp.
                </p>
              )}
            </div>

            {dataset.tables.length > 8 && (
              <input
                value={tableFilter}
                onChange={(e) => setTableFilter(e.target.value)}
                placeholder="Filter tables"
                className="w-full mb-2 px-2 py-1.5 text-[12px] rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border-[0.5px] border-[var(--border)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            )}

            <div className="max-h-[520px] overflow-y-auto -mr-2 pr-2">
              {visibleTables.map((t) => (
                <div key={t.name} className="border-b-[0.5px] border-[var(--border)] last:border-0">
                  <button
                    onClick={() => setOpenTable(openTable === t.name ? null : t.name)}
                    className="w-full text-left py-2 group"
                  >
                    <span className="font-mono text-[12px] text-[var(--text)] group-hover:text-[var(--accent)] break-all">
                      {t.name}
                    </span>
                    <span className="block text-[10px] text-[var(--text-faint)] truncate">
                      {t.event}
                    </span>
                  </button>
                  {openTable === t.name && (
                    <div className="pb-2 pl-2">
                      {t.columns.map((c) => (
                        <button
                          key={c.name}
                          // Not the functional form: `edited` is null until the reader types, and
                          // the thing to append to is the derived `sql`, which is the sample when
                          // they have not.
                          onClick={() => setSql(`${sql}${sql.endsWith(' ') ? '' : ' '}${c.name}`)}
                          title="Append to the query"
                          className="flex items-baseline gap-2 w-full text-left py-0.5 hover:bg-[var(--bg-elevated)] rounded px-1"
                        >
                          <span className="font-mono text-[11px] text-[var(--text)]">{c.name}</span>
                          <span className="text-[10px] text-[var(--text-faint)]">{c.type}</span>
                          {c.indexed && (
                            <span className="text-[9px] text-[var(--accent)] uppercase">idx</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {!visibleTables.length && (
                <p className="text-[11px] text-[var(--text-muted)] py-3">Nothing matches that.</p>
              )}
            </div>
          </Card>

          {/* Editor + results */}
          <div className="space-y-4">
            <Card>
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void run();
                  }
                }}
                spellCheck={false}
                rows={7}
                className="w-full font-mono text-[13px] leading-relaxed bg-[var(--bg-elevated)] border-[0.5px] border-[var(--border)] rounded-[var(--radius-button)] p-3 text-[var(--text)] outline-none focus:border-[var(--accent)] resize-y"
              />
              <div className="flex items-center justify-between gap-3 mt-3">
                <span className="text-[11px] text-[var(--text-faint)]">
                  SELECT and WITH only. ⌘/Ctrl + Enter to run.
                </span>
                <button
                  onClick={() => void run()}
                  disabled={running || !sql.trim()}
                  className="px-4 py-1.5 rounded-[var(--radius-button)] bg-[var(--accent)] text-[var(--accent-text)] text-sm font-medium disabled:opacity-50"
                >
                  {running ? 'Running…' : 'Run'}
                </button>
              </div>
            </Card>

            {error && (
              <Card className="border-[var(--amber)]">
                <p className="text-sm text-[var(--amber)] font-mono break-words">{error}</p>
              </Card>
            )}

            {result && (
              <Card>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <Badge variant="default">
                    {result.count} row{result.count === 1 ? '' : 's'}
                  </Badge>
                  {result.truncated && <Badge variant="warning">truncated at the row cap</Badge>}
                  {result.degraded && (
                    <Badge variant="warning">
                      incomplete: {result.degradedTables.join(', ') || 'some tables reduced'}
                    </Badge>
                  )}
                  {result.tipUnavailable && <Badge variant="warning">sealed history only</Badge>}
                  {result.provenance?.as_of != null && (
                    <span className="text-[11px] text-[var(--text-faint)]">
                      as of block {result.provenance.as_of.toLocaleString()}
                    </span>
                  )}
                </div>
                <ResultTable rows={result.rows} />
              </Card>
            )}

            {/* The honest bit. This surface is for exploring; production has a different door. */}
            <Card>
              <h3 className="text-sm font-semibold text-[var(--text)] mb-1">Using this for real</h3>
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                This endpoint is rate limited and shares one host, so it suits exploring and one-off
                questions rather than anything you would page someone about. For production there
                are two doors: run your own nest, since nuthatch is a single binary and these
                datasets are a config file each, or buy queries from the{' '}
                <Link href="/data-services" className="text-[var(--accent)] hover:underline">
                  Nuthatch Data Service
                </Link>
                , which is the same surface behind a TAP paywall on The Graph&apos;s Horizon
                contracts.
              </p>
              <p className="text-[11px] text-[var(--text-faint)] mt-2">
                Every result carries the block it was true as of, so an answer taken from here can be
                cited rather than merely quoted.
              </p>
            </Card>

            <NamedQueries />
          </div>
        </div>
      )}

      {catalog.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Loading the catalogue…</p>
      )}
    </main>
  );
}

// ── The named-query tier ─────────────────────────────────────────────────────

interface NamedQueryParam {
  name: string;
  type: 'int' | 'address';
  description: string;
}

interface NamedQueryDef {
  name: string;
  dataset: string;
  description: string;
  params: NamedQueryParam[];
  sql: string;
}

interface NamedResult {
  query: string;
  sql: string;
  count: number;
  rows: Record<string, unknown>[];
  provenance: { as_of?: number | null } | null;
}

/**
 * The other door. A caller sends a name and typed arguments; it never sends SQL.
 *
 * Surfaced here rather than left in the docs because a bounded surface nobody can find is a
 * documented secret. Every one of these is pinned to a block, which is what makes its answer
 * reproducible and therefore worth attaching a receipt to.
 */
function NamedQueries() {
  const [openQuery, setOpenQuery] = useState<string | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<NamedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const list = useQuery({
    queryKey: ['named-queries'],
    queryFn: async (): Promise<{ queries: NamedQueryDef[] }> => {
      const res = await fetch('/api/sql/named');
      if (!res.ok) throw new Error('unavailable');
      return res.json();
    },
    staleTime: 30 * 60_000,
  });

  const queries = list.data?.queries ?? [];
  const active = queries.find((q) => q.name === openQuery);

  const run = useCallback(async () => {
    if (!active) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/sql/named', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: active.name, args }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status}).`);
        setResult(null);
      } else {
        setResult(json as NamedResult);
      }
    } catch {
      setError('Could not reach the API.');
      setResult(null);
    } finally {
      setRunning(false);
    }
  }, [active, args]);

  if (!queries.length) return null;

  return (
    <Card>
      <h3 className="text-sm font-semibold text-[var(--text)] mb-1">Named queries</h3>
      <p className="text-[13px] text-[var(--text-muted)] leading-relaxed mb-3">
        The production shape: you send a <strong className="text-[var(--text)]">name and typed
        arguments, never SQL</strong>. Each one is pinned to a block, so the answer is reproducible
        and can carry a{' '}
        <Link href="/verify" className="text-[var(--accent)] hover:underline">
          receipt
        </Link>
        . Rationed more generously than free-form, because a declared question has a cost we chose in
        advance and an arbitrary one has a cost a stranger explores for free.
      </p>

      <div className="flex flex-wrap gap-2 mb-3">
        {queries.map((q) => (
          <button
            key={q.name}
            onClick={() => {
              setOpenQuery(q.name === openQuery ? null : q.name);
              setArgs({});
              setResult(null);
              setError(null);
            }}
            className={cn(
              'px-2.5 py-1 rounded-[var(--radius-button)] text-[12px] font-mono border-[0.5px] transition-colors',
              q.name === openQuery
                ? 'bg-[var(--accent)] text-[var(--accent-text)] border-[var(--accent)]'
                : 'bg-[var(--bg-elevated)] text-[var(--text)] border-[var(--border)] hover:border-[var(--accent)]'
            )}
          >
            {q.name}
          </button>
        ))}
      </div>

      {active && (
        <div className="space-y-3">
          <p className="text-[12px] text-[var(--text-muted)]">{active.description}</p>

          {active.params.map((p) => (
            <label key={p.name} className="block">
              <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                {p.name} <span className="text-[var(--accent)]">{p.type}</span>
              </span>
              <input
                value={args[p.name] ?? ''}
                onChange={(e) => setArgs((a) => ({ ...a, [p.name]: e.target.value }))}
                placeholder={p.type === 'address' ? '0x…40 hex' : 'a block number'}
                className="w-full mt-0.5 px-2 py-1.5 font-mono text-[12px] rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border-[0.5px] border-[var(--border)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
              <span className="text-[10px] text-[var(--text-faint)]">{p.description}</span>
            </label>
          ))}

          <button
            onClick={() => void run()}
            disabled={running}
            className="px-4 py-1.5 rounded-[var(--radius-button)] bg-[var(--accent)] text-[var(--accent-text)] text-sm font-medium disabled:opacity-50"
          >
            {running ? 'Running…' : 'Ask'}
          </button>

          {error && (
            <p className="text-[12px] text-[var(--amber)] font-mono break-words">{error}</p>
          )}

          {result && (
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Badge variant="default">
                  {result.count} row{result.count === 1 ? '' : 's'}
                </Badge>
                {result.provenance?.as_of != null && (
                  <span className="text-[11px] text-[var(--text-faint)]">
                    as of block {result.provenance.as_of.toLocaleString()}
                  </span>
                )}
              </div>
              {/* Shown because a name is stable but the statement is what the nest answered, and a
                  reader is entitled to see which. */}
              <pre className="text-[10px] font-mono text-[var(--text-faint)] whitespace-pre-wrap break-words bg-[var(--bg-elevated)] rounded p-2 mb-2">
                {result.sql}
              </pre>
              <ResultTable rows={result.rows} />
              <TakeAReceipt name={active.name} args={args} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * The bridge between three things this dashboard already has and nobody connects.
 *
 * A named query is pinned, so its answer is reproducible; `tattler` signs a reproducible answer;
 * `/verify` checks a signature offline. Standing on this page you would never know the other two
 * exist, which makes them a product only to whoever built them.
 *
 * Deliberately a **command, not a button.** A button would mean this dashboard holds a signing key
 * and issues receipts in its own name, and a receipt is only worth what its issuer is worth — so
 * yours should be signed by you. This prints the exact invocation for the query you just ran, and
 * says plainly what it needs, rather than implying a click produces a receipt.
 */
function TakeAReceipt({ name, args }: { name: string; args: Record<string, string> }) {
  const [copied, setCopied] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  // Downloaded rather than displayed: a receipt is a file you hand somebody, and the useful next
  // step is dropping it on /verify or replaying it, neither of which wants it pasted out of a page.
  const download = useCallback(async () => {
    setIssuing(true);
    setIssueError(null);
    try {
      const res = await fetch('/api/sql/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, args }),
      });
      const json = await res.json();
      if (!res.ok) {
        setIssueError(json.error ?? `Request failed (${res.status}).`);
        return;
      }
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${name}-${args.before_block ?? 'pinned'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setIssueError('Could not reach the receipt API.');
    } finally {
      setIssuing(false);
    }
  }, [name, args]);

  const argLine = Object.entries(args)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `--arg ${k}=${v}`)
    .join(' ');
  const cmd = `tattler attest-named \\\n  --endpoint ${
    typeof window === 'undefined' ? 'https://www.lodestar-dashboard.com' : window.location.origin
  } \\\n  --name ${name} ${argLine} \\\n  --key issuer.key --out receipt.json`;

  return (
    <div className="mt-3 pt-3 border-t-[0.5px] border-[var(--border)]">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-medium text-[var(--text)]">Take a signed receipt</span>
        <button
          onClick={() => void download()}
          disabled={issuing}
          className="text-[10px] px-2 py-0.5 rounded-[var(--radius-button)] bg-[var(--accent)] text-[var(--accent-text)] disabled:opacity-50"
        >
          {issuing ? 'signing…' : 'download'}
        </button>
      </div>

      {issueError && (
        <p className="text-[10px] text-[var(--amber)] font-mono break-words mb-2">{issueError}</p>
      )}

      <p className="text-[10px] text-[var(--text-faint)] mb-2 leading-relaxed">
        Signed by this dashboard, so it is worth what this dashboard is worth. What makes a receipt
        evidence is <strong className="text-[var(--text)]">replay</strong>: anyone with a nest of the
        same data can re-ask the question and compare hashes, and agreement between parties who did
        not coordinate is the part a signature cannot fake. Or sign it yourself:
      </p>

      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] text-[var(--text-faint)]">with your own key</span>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(cmd.replace(/\\\n/g, ' ')).then(
              () => setCopied(true),
              () => setCopied(false)
            );
          }}
          className="text-[10px] px-2 py-0.5 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border-[0.5px] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre className="text-[10px] font-mono text-[var(--text-faint)] whitespace-pre-wrap break-all bg-[var(--bg-elevated)] rounded p-2">
        {cmd}
      </pre>
      <p className="text-[10px] text-[var(--text-faint)] mt-1 leading-relaxed">
        Needs{' '}
        <a
          href="https://github.com/nightswatchhq/tattler"
          target="_blank"
          rel="noreferrer"
          className="text-[var(--accent)] hover:underline"
        >
          tattler
        </a>{' '}
        and a key of your own, so the receipt is signed by you rather than by us. Anyone can then
        check it at{' '}
        <Link href="/verify" className="text-[var(--accent)] hover:underline">
          /verify
        </Link>{' '}
        without trusting either of us, and replay it against a nest we do not run.
      </p>
    </div>
  );
}
