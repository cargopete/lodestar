'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { formatGRT, shortenAddress, formatRelativeTime, formatPercent, cn } from '@/lib/utils';
import {
  useFoghornStats,
  useFoghornIndexers,
  useNeedsAttention,
  useDeploymentNames,
  useVerdicts,
  useSybilClusters,
  useNonDeterministic,
  useFoghornFeed,
} from '@/hooks/useFoghorn';
import {
  gradeVariant,
  severityVariant,
  scoreColor,
  kindLabel,
  type SubScores,
  type AttentionItem,
} from '@/lib/foghorn';
import { FoghornAlertBanner } from '@/components/foghorn/FoghornAlertBanner';

function indexerLabel(address: string, ens?: string | null) {
  return ens || shortenAddress(address, 4);
}

// Foghorn timestamps are ISO strings; formatRelativeTime expects unix seconds.
function rel(iso: string): string {
  return formatRelativeTime(new Date(iso).getTime() / 1000);
}

// Fixed order + unambiguous 2-letter abbreviations (avoids the Correctness/Coverage "C" clash).
const SUB_SCORE_KEYS: Array<{ key: keyof SubScores; abbr: string; label: string }> = [
  { key: 'correctness', abbr: 'Co', label: 'Correctness' },
  { key: 'availability', abbr: 'Av', label: 'Availability' },
  { key: 'freshness', abbr: 'Fr', label: 'Freshness' },
  { key: 'coverage', abbr: 'Cv', label: 'Coverage' },
  { key: 'value', abbr: 'Va', label: 'Value' },
];

function SubScoreBar({ abbr, label, value }: { abbr: string; label: string; value: number | null }) {
  return (
    <div className="flex items-center gap-1.5" title={`${label}: ${value == null ? 'no data' : value.toFixed(0)}`}>
      <span className="w-4 text-[9px] text-[var(--text-faint)]">{abbr}</span>
      <div className="h-1.5 flex-1 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${value ?? 0}%`, backgroundColor: scoreColor(value) }}
        />
      </div>
    </div>
  );
}

function SubScoreGrid({ s }: { s: SubScores }) {
  return (
    <div className="grid grid-cols-1 gap-1 min-w-[150px]">
      {SUB_SCORE_KEYS.map(({ key, abbr, label }) => (
        <SubScoreBar key={key} abbr={abbr} label={label} value={s[key]} />
      ))}
    </div>
  );
}

// Evidence line, minus the deployment list (rendered as chips instead).
function evidenceLine(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .filter(([k, v]) => k !== 'deployments' && k !== 'examples' && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'number' ? Math.round(v * 100) / 100 : String(v)}`)
    .join(' · ');
}

// Pull the full deployment-ID list out of an attention item's detail — the
// `deployments` rollup array (or legacy `examples`), or the single deployment_id.
function attentionDeployments(item: AttentionItem): string[] {
  const raw = item.detail?.deployments ?? item.detail?.examples;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return item.deployment_id ? [item.deployment_id] : [];
}

// ── Needs Attention ───────────────────────────────────────────────────────────

function DeploymentChip({ id, name }: { id: string; name?: string }) {
  return (
    <Link
      href={`/subgraphs/${id}`}
      className={cn(
        'text-[11px] px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--accent-text)] transition-colors max-w-[200px] truncate',
        !name && 'font-mono'
      )}
      title={name ? `${name} · ${id}` : id}
    >
      {name || shortenAddress(id, 6)}
    </Link>
  );
}

const ATTENTION_COLLAPSED = 6; // deployment chips shown before "+N more"

function AttentionCard({ item, names }: { item: AttentionItem; names: Record<string, string> }) {
  const [expanded, setExpanded] = useState(false);
  const deployments = attentionDeployments(item);
  const evidence = evidenceLine(item.detail);
  const visible = expanded ? deployments : deployments.slice(0, ATTENTION_COLLAPSED);
  const hidden = deployments.length - visible.length;

  return (
    <Card className="border-l-2 border-l-[var(--red)] min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={severityVariant(item.severity)}>{item.severity}</Badge>
            <Badge variant="warning">{kindLabel(item.kind)}</Badge>
            <Link
              href={`/indexers/${item.indexer_address}`}
              className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent-text)] truncate"
            >
              {indexerLabel(item.indexer_address, item.ens_name)}
            </Link>
          </div>
          <p className="text-sm text-[var(--text)] mt-1.5">{item.title}</p>
          {evidence && (
            <p className="text-[11px] text-[var(--text-faint)] mt-1 break-words">{evidence}</p>
          )}
          {deployments.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {visible.map((d) => (
                <DeploymentChip key={d} id={d} name={names[d]} />
              ))}
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="text-[11px] font-medium px-1.5 py-0.5 rounded text-[var(--accent-text)] hover:bg-[var(--bg-elevated)] transition-colors"
                >
                  +{hidden} more
                </button>
              )}
              {expanded && deployments.length > ATTENTION_COLLAPSED && (
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="text-[11px] font-medium px-1.5 py-0.5 rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] transition-colors"
                >
                  Show less
                </button>
              )}
            </div>
          )}
        </div>
        <span className="text-[11px] text-[var(--text-faint)] whitespace-nowrap">
          {rel(item.first_seen)}
        </span>
      </div>
    </Card>
  );
}

// Does an attention item match the indexer + subgraph filters (both optional, ANDed)?
// Subgraph filter matches either the deployment hash or its resolved display name.
function attentionMatches(
  item: AttentionItem,
  indexerQ: string,
  subgraphQ: string,
  names: Record<string, string>
): boolean {
  if (indexerQ) {
    const hay = `${item.ens_name ?? ''} ${item.indexer_address}`.toLowerCase();
    if (!hay.includes(indexerQ)) return false;
  }
  if (subgraphQ) {
    const deps = attentionDeployments(item);
    const match = deps.some(
      (d) => d.toLowerCase().includes(subgraphQ) || (names[d] ?? '').toLowerCase().includes(subgraphQ)
    );
    if (!match) return false;
  }
  return true;
}

function NeedsAttentionSection() {
  const { data, isLoading, isError } = useNeedsAttention();
  const items = data?.items ?? [];
  const [indexerFilter, setIndexerFilter] = useState('');
  const [subgraphFilter, setSubgraphFilter] = useState('');

  const allHashes = items.flatMap(attentionDeployments);
  const { data: names = {} } = useDeploymentNames(allHashes);

  const iq = indexerFilter.trim().toLowerCase();
  const sq = subgraphFilter.trim().toLowerCase();
  const filtering = iq !== '' || sq !== '';
  const filtered = filtering ? items.filter((it) => attentionMatches(it, iq, sq, names)) : items;

  const inputClass =
    'flex-1 min-w-0 px-3 py-1.5 text-sm rounded-[var(--radius-card)] bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors';

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-[var(--text)]">Needs Attention</h2>
        {items.length > 0 && <Badge variant="error">{items.length}</Badge>}
      </div>

      {!isLoading && !isError && items.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={indexerFilter}
            onChange={(e) => setIndexerFilter(e.target.value)}
            placeholder="Filter by indexer (name or address)…"
            className={inputClass}
          />
          <input
            type="text"
            value={subgraphFilter}
            onChange={(e) => setSubgraphFilter(e.target.value)}
            placeholder="Filter by subgraph (name or hash)…"
            className={inputClass}
          />
          {filtering && (
            <button
              type="button"
              onClick={() => {
                setIndexerFilter('');
                setSubgraphFilter('');
              }}
              className="px-3 py-1.5 text-sm rounded-[var(--radius-card)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] transition-colors whitespace-nowrap"
            >
              Clear
            </button>
          )}
        </div>
      )}
      {filtering && (
        <p className="text-[11px] text-[var(--text-faint)]">
          Showing {filtered.length} of {items.length}
        </p>
      )}

      {isLoading ? (
        <Card><p className="text-sm text-[var(--text-muted)]">Loading…</p></Card>
      ) : isError ? (
        <Card><p className="text-sm text-[var(--text-muted)]">Foghorn data unavailable.</p></Card>
      ) : items.length === 0 ? (
        <Card className="border-l-2 border-l-[var(--green)]">
          <p className="text-sm text-[var(--green)]">
            All clear. No indexers are currently serving bad or no data.
          </p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--text-muted)]">
            Nothing found for this filter.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          {filtered.map((it) => (
            <AttentionCard key={`${it.indexer_address}-${it.kind}-${it.deployment_id}`} item={it} names={names} />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Leaderboard ────────────────────────────────────────────────────────────────

function Leaderboard() {
  const [window, setWindow] = useState<7 | 30>(30);
  const { data, isLoading, isError } = useFoghornIndexers(window);
  const rows = data?.indexers ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--text)]">Indexer Grades</h2>
        <div className="flex gap-1 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] p-0.5">
          {([7, 30] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={cn(
                'px-2.5 py-1 text-[11px] rounded-[var(--radius-button)] transition-colors',
                window === w ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)]'
              )}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-[var(--text-faint)]">
        Sub-scores (top→bottom): <span className="text-[var(--text-muted)]">Co</span> Correctness ·{' '}
        <span className="text-[var(--text-muted)]">Av</span> Availability ·{' '}
        <span className="text-[var(--text-muted)]">Fr</span> Freshness ·{' '}
        <span className="text-[var(--text-muted)]">Cv</span> Coverage ·{' '}
        <span className="text-[var(--text-muted)]">Va</span> Value. Bar colour:{' '}
        <span className="text-[var(--green)]">green ≥75</span> ·{' '}
        <span className="text-[var(--amber)]">amber ≥50</span> ·{' '}
        <span className="text-[var(--red)]">red &lt;50</span>.
      </p>
      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <p className="text-sm text-[var(--text-muted)] p-4">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-[var(--text-muted)] p-4">Foghorn data unavailable.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase text-[var(--text-faint)] border-b border-[var(--border)]">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Indexer</th>
                  <th className="px-3 py-2 font-medium">Grade</th>
                  <th className="px-3 py-2 font-medium text-right">Score</th>
                  <th className="px-3 py-2 font-medium">Sub-scores</th>
                  <th className="px-3 py-2 font-medium text-right">Self-stake</th>
                  <th className="px-3 py-2 font-medium text-right">Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((ix, i) => (
                  <tr
                    key={ix.indexer_address}
                    className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-elevated)]/40"
                  >
                    <td className="px-3 py-2 text-[var(--text-faint)] font-mono">{i + 1}</td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/indexers/${ix.indexer_address}`}
                        className="text-[var(--text)] hover:text-[var(--accent-text)]"
                      >
                        {indexerLabel(ix.indexer_address, ix.ens_name)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {ix.rated ? (
                        <Badge variant={gradeVariant(ix.grade)}>{ix.grade}</Badge>
                      ) : (
                        <Badge variant="default" title="Inactive: no queries, allocations, or probe coverage">NR</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {ix.rated ? ix.composite.toFixed(0) : <span className="text-[var(--text-faint)]">—</span>}
                    </td>
                    <td className="px-3 py-2">{ix.rated ? <SubScoreGrid s={ix.sub_scores} /> : null}</td>
                    <td className="px-3 py-2 text-right font-mono text-[var(--text-muted)]">
                      {ix.self_stake_grt != null ? formatGRT(ix.self_stake_grt) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right space-x-1 whitespace-nowrap">
                      {ix.verdict_count > 0 && <Badge variant="warning">{ix.verdict_count}⚑</Badge>}
                      {ix.sybil_flag && <Badge variant="error" title="Sybil swarm member">sybil</Badge>}
                      {ix.needs_attention && <Badge variant="error" title="Needs attention">!</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}

// ── Verdicts ─────────────────────────────────────────────────────────────────

const VERDICT_KINDS = [
  'serving-bad-data',
  'serving-no-data',
  'behind-chainhead',
  'leech',
  'reo-ineligible-candidate',
  'dispute-candidate',
  'low-coverage',
  'sybil-swarm-member',
];

function VerdictsSection() {
  const [kind, setKind] = useState<string | undefined>(undefined);
  const { data, isLoading, isError } = useVerdicts({ kind, limit: 200 });
  const verdicts = data?.verdicts ?? [];

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-[var(--text)]">Verdicts</h2>
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setKind(undefined)}
          className={cn(
            'px-2.5 py-1 text-[11px] rounded-[var(--radius-badge)] transition-colors',
            !kind ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
          )}
        >
          All
        </button>
        {VERDICT_KINDS.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={cn(
              'px-2.5 py-1 text-[11px] rounded-[var(--radius-badge)] transition-colors',
              kind === k ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
            )}
          >
            {kindLabel(k)}
          </button>
        ))}
      </div>
      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <p className="text-sm text-[var(--text-muted)] p-4">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-[var(--text-muted)] p-4">Foghorn data unavailable.</p>
        ) : verdicts.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] p-4">No verdicts for this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {/* The design has no visible header row, but the columns still
                  need names for anyone navigating this table by screen reader. */}
              <thead className="sr-only">
                <tr>
                  <th scope="col">Severity</th>
                  <th scope="col">Type</th>
                  <th scope="col">Indexer and finding</th>
                  <th scope="col">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {verdicts.map((v) => (
                  <tr
                    key={`${v.indexer_address}-${v.kind}`}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-3 py-2 w-[1%] whitespace-nowrap">
                      <Badge variant={severityVariant(v.severity)}>{v.severity}</Badge>
                    </td>
                    <td className="px-3 py-2 w-[1%] whitespace-nowrap">
                      <Badge variant="default">{kindLabel(v.kind)}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/indexers/${v.indexer_address}`}
                        className="text-[var(--text)] hover:text-[var(--accent-text)]"
                      >
                        {indexerLabel(v.indexer_address, v.ens_name)}
                      </Link>
                      <span className="text-[var(--text-muted)]"> · {v.title}</span>
                      <span className="block text-[11px] text-[var(--text-faint)]">{evidenceLine(v.evidence)}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-[11px] text-[var(--text-faint)] whitespace-nowrap">
                      {rel(v.last_seen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}

// ── Sybil clusters ─────────────────────────────────────────────────────────────

function SybilSection() {
  const { data, isLoading } = useSybilClusters();
  const clusters = data?.clusters ?? [];
  if (!isLoading && clusters.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-[var(--text)]">Sybil Swarms</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {clusters.map((c) => (
          <Card key={c.cluster_id}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-[var(--text)]">{c.cluster_id}</span>
              <Badge variant="error">{formatPercent(c.confidence * 100, 0)} confidence</Badge>
            </div>
            <p className="text-[11px] text-[var(--text-faint)] mt-1">{evidenceLine(c.signals)}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {c.members.map((m) => (
                <Link
                  key={m}
                  href={`/indexers/${m}`}
                  className="font-mono text-[11px] text-[var(--accent-text)] hover:underline"
                >
                  {shortenAddress(m, 4)}
                </Link>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

// ── Non-deterministic subgraphs ──────────────────────────────────────────────

function NonDeterministicSection() {
  const { data, isLoading } = useNonDeterministic();
  const deps = data?.deployments ?? [];
  if (!isLoading && deps.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-[var(--text)]">Non-deterministic Subgraphs</h2>
      <p className="text-sm text-[var(--text-muted)]">
        These deployments diverge across indexers every probe round; their mappings are
        non-deterministic (the subgraph&apos;s issue, not the indexers&apos;). Indexers are
        <span className="text-[var(--text)]"> not penalised</span> for serving them.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {deps.map((d) => (
          <Card key={d.deployment_id}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-[var(--text)]">{shortenAddress(d.deployment_id, 8)}</span>
              <Badge variant="warning">
                {formatPercent(d.divergence_rate * 100, 0)} of {d.total_probes} probes
              </Badge>
            </div>
            {d.sample_fields.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {d.sample_fields.map((f) => (
                  <span key={f} className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                    {f}
                  </span>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}

// ── Divergence feed ──────────────────────────────────────────────────────────

function DivergenceFeed() {
  const { data, isLoading } = useFoghornFeed(30);
  const events = data?.events ?? [];
  if (!isLoading && events.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-[var(--text)]">Recent Divergences</h2>
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-[var(--text-faint)] border-b border-[var(--border)]">
                <th className="px-3 py-2 font-medium">Probe</th>
                <th className="px-3 py-2 font-medium">Deployment</th>
                <th className="px-3 py-2 font-medium">Query</th>
                <th className="px-3 py-2 font-medium text-right">Block</th>
                <th className="px-3 py-2 font-medium text-right">Clusters</th>
                <th className="px-3 py-2 font-medium text-right">Diff ops</th>
                <th className="px-3 py-2 font-medium text-right">When</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.probe_id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-2">
                    <Link
                      href={`/foghorn/probe/${e.probe_id}`}
                      className="font-mono text-[11px] text-[var(--accent-text)] hover:underline"
                    >
                      {e.probe_id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-muted)]">
                    {shortenAddress(e.deployment_id, 6)}
                  </td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{e.query_category}</td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--text-muted)]">{e.block_number}</td>
                  <td className="px-3 py-2 text-right"><Badge variant="warning">{e.cluster_count}</Badge></td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--text-muted)]">{e.diff_patch_count}</td>
                  <td className="px-3 py-2 text-right text-[11px] text-[var(--text-faint)]">
                    {rel(e.dispatched_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

// ── Stats strip ────────────────────────────────────────────────────────────────

// ── What Foghorn actually tests (honest methodology) ─────────────────────────

function MethodologyPanel() {
  const { data: stats } = useFoghornStats();
  const { data: indexers } = useFoghornIndexers(30);
  const probed = stats?.deployments_covered;
  const correctnessIndexers = indexers?.indexers.filter((i) => i.probe_count > 0).length;
  const total = indexers?.count;

  return (
    <Card className="border-l-2 border-l-[var(--accent)]">
      <CardHeader>
        <CardTitle>What Foghorn actually tests</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-[var(--text-muted)]">
        <p>
          Most of an indexer&apos;s grade comes from network telemetry that applies to everyone;
          only <span className="text-[var(--text)]">correctness</span> is Foghorn&apos;s own
          measurement, and it only covers indexers serving the deployments Foghorn probes.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-[var(--radius-card)] bg-[var(--bg-elevated)] p-3">
            <p className="text-[var(--text)] font-medium mb-1">
              Directly probed by Foghorn: <span className="text-[var(--green)]">correctness</span>
            </p>
            <p>
              Block-pinned GraphQL queries sent through the gateway, responses canonicalised (JCS)
              and SHA-256 hashed; an indexer that returns minority (divergent) data versus consensus
              is flagged. Catches confident, well-formed <em>wrong</em> data that QoS can&apos;t see.
            </p>
            {probed != null && correctnessIndexers != null && (
              <p className="mt-2 text-[11px] text-[var(--text-faint)]">
                Currently probing <span className="text-[var(--text)]">{probed}</span> deployments;{' '}
                <span className="text-[var(--text)]">{correctnessIndexers}</span>
                {total != null ? ` of ${total}` : ''} indexers have correctness coverage so far
                (expands automatically as Foghorn discovers more deployments).
              </p>
            )}
          </div>
          <div className="rounded-[var(--radius-card)] bg-[var(--bg-elevated)] p-3">
            <p className="text-[var(--text)] font-medium mb-1">Read from the network, applies to all indexers</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li><span className="text-[var(--text)]">QoS oracle:</span> success rate (errors/400s), latency, chainhead lag, query volume, all measured from real query traffic rather than Foghorn.</li>
              <li><span className="text-[var(--text)]">On-chain / network subgraph:</span> self-stake, allocations (coverage), REO eligibility.</li>
              <li><span className="text-[var(--text)]">Derived by Foghorn:</span> sybil-swarm clustering and leech detection from roster patterns.</li>
            </ul>
          </div>
        </div>
        <p className="text-[11px] text-[var(--text-faint)]">
          So today the composite leans on QoS / stake / coverage for most indexers; correctness is
          the differentiator wherever Foghorn has probed. &quot;NR&quot; = inactive / unrated.
        </p>
      </CardContent>
    </Card>
  );
}

function StatsStrip() {
  const { data: stats } = useFoghornStats();
  const { data: attn } = useNeedsAttention();
  const { data: verdicts } = useVerdicts({ limit: 500 });
  const { data: indexers } = useFoghornIndexers(30);

  const ratedCount = indexers?.indexers.filter((i) => i.rated).length;
  return (
    <StatGrid>
      <StatCard
        label="Indexers graded"
        value={ratedCount != null ? String(ratedCount) : '—'}
        subtitle={indexers ? `${indexers.count - (ratedCount ?? 0)} unrated / inactive` : undefined}
      />
      <StatCard
        label="Needs attention"
        value={attn ? String(attn.count) : '—'}
        subtitle="serving bad / no data"
      />
      <StatCard label="Open verdicts" value={verdicts ? String(verdicts.count) : '—'} />
      <StatCard
        label="Divergences (24h)"
        value={stats ? String(stats.divergences_24h) : '—'}
        subtitle={stats ? `${(stats.divergence_rate_24h * 100).toFixed(1)}% of probes` : undefined}
      />
    </StatGrid>
  );
}

export default function FoghornPage() {
  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-[var(--text)]">Foghorn</h1>
          <Badge variant="accent">Network-quality judge</Badge>
        </div>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          A composite A–F grade per indexer, fusing Foghorn&apos;s own correctness probing with
          The Graph&apos;s QoS oracle, on-chain stake and REO data, plus actionable verdicts and a
          live needs-attention triage.
        </p>
      </div>

      <FoghornAlertBanner />
      <MethodologyPanel />
      <StatsStrip />
      <NeedsAttentionSection />
      <Leaderboard />
      <VerdictsSection />
      <SybilSection />
      <NonDeterministicSection />
      <DivergenceFeed />
    </div>
  );
}
