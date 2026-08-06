'use client';

import { useState } from 'react';
import type { DataService } from '@/data/data-services';
import { cn } from '@/lib/utils';

type RunState = 'idle' | 'loading' | 'done' | 'error';

interface QueryResponse {
  ok: boolean;
  status?: number;
  durationMs?: number;
  endpoint?: string;
  result?: unknown;
  error?: string;
}

export function Playground({ service }: { service: DataService }) {
  const pg = service.playground;
  const [state, setState] = useState<RunState>('idle');
  const [resp, setResp] = useState<QueryResponse | null>(null);
  const [copied, setCopied] = useState(false);

  if (!pg) return null;

  async function run() {
    setState('loading');
    setResp(null);
    try {
      const r = await fetch('/api/data-services/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: service.slug }),
      });
      const j: QueryResponse = await r.json();
      setResp(j);
      setState(j.ok ? 'done' : 'error');
    } catch (e) {
      setResp({ ok: false, error: e instanceof Error ? e.message : String(e) });
      setState('error');
    }
  }

  function copyCode() {
    navigator.clipboard?.writeText(pg!.exampleCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const resultText =
    resp?.result !== undefined
      ? typeof resp.result === 'string'
        ? resp.result
        : JSON.stringify(resp.result, null, 2)
      : resp?.error ?? '';

  return (
    <div className="mt-6 pt-5 border-t border-[var(--border)]">
      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-[11px] font-semibold text-[var(--accent-text)] uppercase tracking-wide">Playground</h4>
        <span className="text-[10px] text-[var(--text-faint)] font-mono truncate">{pg.endpoint}</span>
      </div>

      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
        {/* ── Left: live runner ─────────────────────────────────────────── */}
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <p className="text-xs text-[var(--text-muted)]">{pg.sampleLabel}</p>
            {pg.runnable && (
              <button
                type="button"
                onClick={run}
                disabled={state === 'loading'}
                className={cn(
                  'shrink-0 inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-[var(--radius-button)] transition-colors',
                  state === 'loading'
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-faint)] cursor-wait'
                    : 'bg-[var(--accent)]/15 text-[var(--accent-text)] hover:bg-[var(--accent)]/25',
                )}
              >
                {state === 'loading' ? (
                  <>
                    <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    Querying…
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M6.3 2.8A1 1 0 014.8 3.6v12.8a1 1 0 001.5.8l10-6.4a1 1 0 000-1.6l-10-6.4z" />
                    </svg>
                    {state === 'idle' ? 'Run sample query' : 'Run again'}
                  </>
                )}
              </button>
            )}
          </div>

          {!pg.runnable && pg.note && (
            <p className="text-[11px] text-[var(--text-faint)] leading-relaxed mb-2.5 italic">{pg.note}</p>
          )}

          {resp && (
            <div className="rounded-[var(--radius-button)] border border-[var(--border)] overflow-hidden">
              <div
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 text-[10px] font-mono border-b border-[var(--border)]',
                  state === 'done' ? 'text-[var(--green)]' : 'text-[var(--amber)]',
                )}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full', state === 'done' ? 'bg-[var(--green)]' : 'bg-[var(--amber)]')} />
                {resp.ok ? `HTTP ${resp.status}` : 'error'}
                {typeof resp.durationMs === 'number' && <span className="text-[var(--text-faint)]">· {resp.durationMs} ms</span>}
                <span className="ml-auto text-[var(--text-faint)]">paid query · TAP receipt</span>
              </div>
              <pre className="px-3 py-2.5 text-[10px] leading-relaxed text-[var(--text-muted)] overflow-auto max-h-64 whitespace-pre-wrap break-all">
                {resultText}
              </pre>
            </div>
          )}
          {!resp && pg.runnable && (
            <div className="rounded-[var(--radius-button)] border border-dashed border-[var(--border)] px-3 py-4 text-center text-[10px] text-[var(--text-faint)]">
              Click run to send a live, paid query to the provider.
            </div>
          )}
        </div>

        {/* ── Right: prerequisites + example code ────────────────────────── */}
        <div className="min-w-0 space-y-4">
          <div>
            <h5 className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wide mb-2">Before you start</h5>
            <ol className="space-y-1.5">
              {pg.prerequisites.map((p, i) => (
                <li key={i} className="flex gap-2 text-[11px] text-[var(--text-muted)] leading-relaxed">
                  <span className="font-mono text-[9px] text-[var(--accent-text)] shrink-0 mt-0.5">{String(i + 1).padStart(2, '0')}</span>
                  <span>{p}</span>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h5 className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wide">
                Example · {pg.exampleLang}
              </h5>
              <button
                type="button"
                onClick={copyCode}
                className="text-[10px] text-[var(--text-faint)] hover:text-[var(--accent-text)] transition-colors"
              >
                {copied ? 'copied ✓' : 'copy'}
              </button>
            </div>
            <pre className="rounded-[var(--radius-button)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[10px] leading-relaxed text-[var(--text-muted)] overflow-auto max-h-72 whitespace-pre">
              {pg.exampleCode}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
