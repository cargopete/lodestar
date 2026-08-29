'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [datasetId, setDatasetId] = useState<string>('');
  const [sql, setSql] = useState<string>('');
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

  const datasets = catalog.data?.datasets ?? [];
  const dataset = datasets.find((d) => d.id === datasetId);

  // Land on the first dataset that can actually answer, so the page opens on something that works.
  useEffect(() => {
    if (datasetId || !datasets.length) return;
    const first = datasets.find((d) => d.available) ?? datasets[0];
    setDatasetId(first.id);
    setSql(first.sample);
  }, [datasets, datasetId]);

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
              setDatasetId(d.id);
              setSql(d.sample);
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
                          onClick={() => setSql((s) => `${s}${s.endsWith(' ') ? '' : ' '}${c.name}`)}
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
          </div>
        </div>
      )}

      {catalog.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Loading the catalogue…</p>
      )}
    </main>
  );
}
