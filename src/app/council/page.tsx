'use client';

import { useEffect, useState } from 'react';
import { timeAgo } from '@/lib/feed';

const SNAPSHOT_SPACE = 'council.graphprotocol.eth';

interface SnapshotProposal {
  id: string;
  title: string;
  state: 'active' | 'closed' | 'pending';
  start: number;
  end: number;
  choices: string[];
  scores: number[];
  scores_total: number;
  votes: number;
}

function useCouncilProposals() {
  const [proposals, setProposals] = useState<SnapshotProposal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/snapshot-proposals')
      .then(r => r.json())
      .then(data => setProposals(data?.proposals ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { proposals, loading };
}

export default function CouncilPage() {
  const { proposals, loading } = useCouncilProposals();

  const active = proposals.filter(p => p.state === 'active').length;
  const closed = proposals.filter(p => p.state === 'closed').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text)]">Council Votes</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Live governance proposals from{' '}
            <span className="font-mono text-[var(--text-faint)]">{SNAPSHOT_SPACE}</span>
          </p>
        </div>
        <a
          href={`https://snapshot.org/#/${SNAPSHOT_SPACE}/proposals`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[var(--accent)] hover:underline flex-shrink-0 mt-1"
        >
          All proposals →
        </a>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-center">
          <p className="text-2xl font-mono font-bold text-[var(--cyan)]">
            {loading ? '—' : active}
          </p>
          <p className="text-xs text-[var(--text-faint)] mt-1">Voting Now</p>
        </div>
        <div className="p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-center">
          <p className="text-2xl font-mono font-bold text-[var(--text-muted)]">
            {loading ? '—' : closed}
          </p>
          <p className="text-xs text-[var(--text-faint)] mt-1">Closed</p>
        </div>
        <div className="p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-center">
          <p className="text-2xl font-mono font-bold text-[var(--text)]">
            {loading ? '—' : proposals.length}
          </p>
          <p className="text-xs text-[var(--text-faint)] mt-1">Total Shown</p>
        </div>
      </div>

      {/* Proposals */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-16 rounded-lg bg-[var(--bg-elevated)] animate-pulse" />
          ))}
        </div>
      ) : proposals.length === 0 ? (
        <p className="text-sm text-[var(--text-faint)] text-center py-10">No proposals found</p>
      ) : (
        <div className="space-y-2">
          {proposals.map((p) => {
            const isActive = p.state === 'active';
            const winningIdx = p.scores.length > 0 ? p.scores.indexOf(Math.max(...p.scores)) : -1;
            const winningChoice = winningIdx >= 0 ? p.choices[winningIdx] : null;
            const winningPct = p.scores_total > 0 && winningIdx >= 0
              ? ((p.scores[winningIdx] / p.scores_total) * 100).toFixed(0)
              : null;

            return (
              <a
                key={p.id}
                href={`https://snapshot.org/#/${SNAPSHOT_SPACE}/proposal/${p.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-3 rounded-lg border-l-[3px] bg-[var(--bg-elevated)] hover:bg-[color-mix(in_srgb,var(--bg-elevated)_90%,var(--cyan)_10%)] transition-colors"
                style={{ borderLeftColor: isActive ? 'var(--cyan)' : 'var(--border)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[13px] font-medium text-[var(--text)] leading-snug line-clamp-2 flex-1">
                    {p.title}
                  </p>
                  <span
                    className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{
                      color: isActive ? 'var(--cyan)' : 'var(--text-faint)',
                      backgroundColor: isActive ? 'var(--cyan-dim)' : 'var(--bg-surface)',
                    }}
                  >
                    {p.state}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[10px] text-[var(--text-faint)]">
                  <span>{p.votes.toLocaleString()} votes</span>
                  {winningChoice && winningPct && (
                    <span>
                      {p.state === 'closed' ? '→ ' : ''}{winningChoice} {winningPct}%
                    </span>
                  )}
                  {isActive
                    ? <span>ends {timeAgo(new Date(p.end * 1000).toISOString())}</span>
                    : <span>{timeAgo(new Date(p.start * 1000).toISOString())}</span>
                  }
                </div>
              </a>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-[var(--text-faint)] text-center px-4">
        Proposals sourced live from Snapshot. Vote results are indicative until voting closes.
      </p>
    </div>
  );
}
