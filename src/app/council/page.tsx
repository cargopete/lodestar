'use client';

import { useEffect, useState } from 'react';
import { timeAgo } from '@/lib/feed';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

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

interface CouncilMember {
  address: string;
  ensName: string | null;
  proposalsVoted: number;
  proposalsTotal: number;
  participationRate: number;
  lastVote: {
    proposalTitle: string;
    choice: string;
    timestamp: number;
  } | null;
}

interface CouncilMembersData {
  members: CouncilMember[];
  totalProposals: number;
  seatCount: number;
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

function useCouncilMembers() {
  const [data, setData] = useState<CouncilMembersData>({ members: [], totalProposals: 0, seatCount: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/council-members')
      .then(r => r.json())
      .then(d => setData({ members: d?.members ?? [], totalProposals: d?.totalProposals ?? 0, seatCount: d?.seatCount ?? 0 }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { ...data, loading };
}

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function choiceColor(choice: string): string {
  if (choice === 'For') return 'var(--green)';
  if (choice === 'Against') return 'var(--error, #ef4444)';
  return 'var(--text-faint)';
}

function participationColor(rate: number): string {
  if (rate >= 70) return 'var(--green)';
  if (rate >= 40) return 'var(--amber)';
  return 'var(--error, #ef4444)';
}

export default function CouncilPage() {
  const { proposals, loading: proposalsLoading } = useCouncilProposals();
  const { members, totalProposals, seatCount, loading: membersLoading } = useCouncilMembers();

  const active = proposals.filter(p => p.state === 'active').length;
  // totalProposals comes from council-members which fetches full history (up to 100)
  // closed = everything that isn't active or pending
  const closed = totalProposals > 0 ? totalProposals - active : proposals.filter(p => p.state === 'closed').length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text)]">Council Votes</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Governance votes by The Graph Council on{' '}
            <span className="font-mono text-[var(--text-faint)]">{SNAPSHOT_SPACE}</span>
          </p>
        </div>
        <a
          href={`https://snapshot.org/#/${SNAPSHOT_SPACE}/proposals`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[var(--accent)] hover:underline flex-shrink-0 mt-1"
        >
          View on Snapshot →
        </a>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-center">
          <p className="text-2xl font-mono font-bold text-[var(--cyan)]">
            {proposalsLoading ? '—' : active}
          </p>
          <p className="text-xs text-[var(--text-faint)] mt-1">Voting Now</p>
        </div>
        <div className="p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-center">
          <p className="text-2xl font-mono font-bold text-[var(--text-muted)]">
            {proposalsLoading ? '—' : closed}
          </p>
          <p className="text-xs text-[var(--text-faint)] mt-1">Closed</p>
        </div>
        <div className="p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-center">
          <p className="text-2xl font-mono font-bold text-[var(--accent)]">
            {membersLoading ? '—' : seatCount || members.length}
          </p>
          <p className="text-xs text-[var(--text-faint)] mt-1">Council Seats</p>
        </div>
      </div>

      {/* How voting works */}
      <div className="p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
        <h2 className="text-sm font-semibold text-[var(--text)] mb-3">How It Works</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Voting window', value: '15 days' },
            { label: 'Seats', value: `${seatCount || 11} members` },
            { label: 'Choices', value: 'For / Against / Abstain' },
            { label: 'Strategy', value: 'multisig-owners' },
          ].map((item) => (
            <div key={item.label}>
              <p className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide">{item.label}</p>
              <p className="text-xs font-medium text-[var(--text)] mt-0.5">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Council members */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-[var(--text)]">Council Members</h2>
          {!membersLoading && totalProposals > 0 && (
            <p className="text-xs text-[var(--text-faint)]">
              last {totalProposals} proposals
            </p>
          )}
        </div>

        {membersLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="h-20 rounded-lg bg-[var(--bg-elevated)] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {members.map((member) => {
              const inactive = member.proposalsVoted === 0;
              return (
              <a
                key={member.address}
                href={`https://etherscan.io/address/${member.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-3 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] border border-[var(--border)] transition-colors"
                style={{ opacity: inactive ? 0.45 : 1 }}
              >
                {/* Name / address */}
                <p className="text-xs font-medium text-[var(--text)] truncate">
                  {member.ensName ?? shortAddress(member.address)}
                </p>
                {member.ensName && (
                  <p className="text-[10px] text-[var(--text-faint)] font-mono truncate mt-0.5">
                    {shortAddress(member.address)}
                  </p>
                )}

                {/* Participation bar */}
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-[var(--text-faint)]">
                      {member.proposalsVoted}/{member.proposalsTotal} voted
                    </span>
                    <span
                      className="text-[10px] font-mono font-medium"
                      style={{ color: participationColor(member.participationRate) }}
                    >
                      {member.participationRate}%
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${member.participationRate}%`,
                        backgroundColor: participationColor(member.participationRate),
                      }}
                    />
                  </div>
                </div>

                {/* Last vote */}
                {inactive ? (
                  <p className="text-[10px] mt-1.5 text-[var(--text-faint)]">No votes on record</p>
                ) : member.lastVote ? (
                  <p className="text-[10px] mt-1.5 truncate" style={{ color: choiceColor(member.lastVote.choice) }}>
                    Last: {member.lastVote.choice}
                  </p>
                ) : null}
              </a>
              );
            })}
          </div>
        )}
      </div>

      {/* Participation radar */}
      {!membersLoading && members.length > 0 && (() => {
        const overallParticipation = members.reduce((s, m) => s + m.participationRate, 0) / members.length;
        const radarData = members.map(m => ({
          name: m.ensName
            ? m.ensName.replace(/\.(eth|xyz|io)$/, '')
            : m.address.slice(0, 6),
          participation: m.participationRate,
          address: m.address,
        }));
        return (
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-base font-semibold text-[var(--text)]">Participation Overview</h2>
              <p className="text-xs text-[var(--text-faint)]">
                avg{' '}
                <span className="font-mono font-bold" style={{ color: 'var(--accent)' }}>
                  {overallParticipation.toFixed(1)}%
                </span>
              </p>
            </div>
            <div className="p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
              <ResponsiveContainer width="100%" height={320}>
                <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                  <PolarGrid stroke="var(--border)" strokeOpacity={0.6} />
                  <PolarAngleAxis
                    dataKey="name"
                    tick={{ fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'monospace' }}
                  />
                  <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar
                    dataKey="participation"
                    stroke="var(--accent)"
                    fill="var(--accent)"
                    fillOpacity={0.15}
                    strokeWidth={1.5}
                    dot={{ fill: 'var(--accent)', r: 3, strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: 'var(--accent)' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: 'var(--text)',
                    }}
                    formatter={(value) => [`${value}%`, 'Participation']}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* Active proposals first, then all */}
      <div>
        <h2 className="text-base font-semibold text-[var(--text)] mb-3">Proposals</h2>

        {proposalsLoading ? (
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
      </div>

      <p className="text-[11px] text-[var(--text-faint)] text-center px-4">
        Proposals and votes sourced live from Snapshot. Participation stats cover up to the last {totalProposals || '—'} proposals, counted only from when each member joined the multisig.
      </p>
    </div>
  );
}
