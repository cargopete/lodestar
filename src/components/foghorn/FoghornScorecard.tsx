'use client';

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { useFoghornScorecard, useIndexerQuality } from '@/hooks/useFoghorn';
import { gradeVariant, severityVariant, scoreColor, kindLabel, type SubScores } from '@/lib/foghorn';

const SUBS: Array<[keyof SubScores, string]> = [
  ['correctness', 'Correctness'],
  ['availability', 'Availability'],
  ['freshness', 'Freshness'],
  ['coverage', 'Coverage'],
  ['value', 'Value'],
];

function Bar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-[11px] text-[var(--text-muted)]">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value ?? 0}%`, backgroundColor: scoreColor(value) }} />
      </div>
      <span className="w-8 text-right text-[11px] font-mono text-[var(--text-muted)]">
        {value == null ? '—' : value.toFixed(0)}
      </span>
    </div>
  );
}

export function FoghornScorecard({ address }: { address: string }) {
  const { data, isError, isLoading } = useFoghornScorecard(address);
  const { data: quality } = useIndexerQuality(address);

  // Service down / not configured → render nothing (don't clutter the profile).
  if (isError) return null;

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader><CardTitle>Foghorn Grade</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-[var(--text-muted)]">Loading…</p></CardContent>
      </Card>
    );
  }

  const scores = [...data.scores].sort((a, b) => b.window_days - a.window_days);
  const primary = scores[0];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Foghorn Grade</CardTitle>
          <Link href="/foghorn" className="text-[11px] text-[var(--accent)] hover:underline">
            Network-quality judge ↗
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!primary ? (
          <p className="text-sm text-[var(--text-muted)]">Not yet graded.</p>
        ) : !primary.rated ? (
          <p className="text-sm text-[var(--text-muted)]">
            Unrated — this indexer has no query volume, allocations, or probe coverage to judge.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Badge variant={gradeVariant(primary.grade)} className="text-base px-3 py-1">{primary.grade}</Badge>
              <span className="text-2xl font-semibold font-mono text-[var(--text)]">{primary.composite.toFixed(0)}</span>
              <span className="text-[11px] text-[var(--text-faint)]">/ 100 · {primary.window_days}d</span>
              <div className="ml-auto flex gap-1.5">
                {scores.map((s) => (
                  <span key={s.window_days} className="text-[11px] text-[var(--text-muted)]">
                    {s.window_days}d <span className="font-mono text-[var(--text)]">{s.grade}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              {SUBS.map(([key, label]) => (
                <Bar key={key} label={label} value={primary.sub_scores[key]} />
              ))}
            </div>

            {primary.reasons.length > 0 && (
              <ul className="text-[11px] text-[var(--text-muted)] list-disc pl-4 space-y-0.5">
                {primary.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
          </>
        )}

        {data.verdicts.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase text-[var(--text-faint)]">Verdicts</p>
            {data.verdicts.map((v) => (
              <div key={v.kind} className="flex items-center gap-2">
                <Badge variant={severityVariant(v.severity)}>{kindLabel(v.kind)}</Badge>
                <span className="text-[12px] text-[var(--text-muted)]">{v.title}</span>
              </div>
            ))}
          </div>
        )}

        {data.sybil_cluster && (
          <div className="rounded-[var(--radius-card)] border border-[var(--red)]/40 bg-[var(--red-dim)] p-2">
            <p className="text-[12px] text-[var(--red)]">
              Probable operator-swarm member — {(data.sybil_cluster.confidence * 100).toFixed(0)}% confidence,
              {' '}{data.sybil_cluster.member_count} identities (<span className="font-mono">{data.sybil_cluster.cluster_id}</span>)
            </p>
          </div>
        )}

        {quality && quality.recent_probes.length > 0 && (
          <div>
            <p className="text-[11px] uppercase text-[var(--text-faint)] mb-1">Recent probes</p>
            <div className="flex flex-wrap gap-1">
              {quality.recent_probes.map((p) => (
                <Link
                  key={p.probe_id}
                  href={`/foghorn/probe/${p.probe_id}`}
                  title={`${p.query_category} · ${new Date(p.dispatched_at).toLocaleString()}${p.divergent ? ' · divergent' : ''}`}
                  className={cn(
                    'h-3 w-3 rounded-sm',
                    p.response_hash == null
                      ? 'bg-[var(--red)]'
                      : p.divergent
                        ? 'bg-[var(--amber)]'
                        : 'bg-[var(--green)]'
                  )}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
