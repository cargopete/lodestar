'use client';

/**
 * The Lodestar Oracle — Lodestar's own quality-of-service feed for The Graph.
 *
 * There is no canonical QoS oracle, and this page no longer pretends otherwise. Two independent
 * oracles publish QoS for this network: Edge & Node's, built on what their gateway routed, and this
 * one, built on active probing. They measure different populations by different means and neither
 * is authoritative over the other. Lodestar used to also mirror and serve their data; it does not
 * any more, because republishing someone else's numbers under our name bought a dependency on their
 * pipeline and nothing we could not measure ourselves.
 *
 * The headline is deliberately *freshness*, not any individual metric. On 2026-07-29 Edge & Node's
 * publisher stopped for 35 hours and no consumer could tell, because a stale subgraph answers
 * queries exactly like a fresh one. Putting both oracles' ages at the top makes that failure
 * visible the moment it happens — ours included, which is the point.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { Pagination } from '@/components/ui/Pagination';
import { ExportButton } from '@/components/ui/ExportButton';
import {
  useQosStatus,
  useQosBuckets,
  useQosCompare,
  useDeploymentNames,
  useFoghornIndexers,
} from '@/hooks/useFoghorn';
import type { BadgeVariant } from '@/components/ui/Badge';
import type { FoghornQosSource } from '@/lib/foghorn';
import { shortenAddress, cn } from '@/lib/utils';
import { gradeVariant } from '@/lib/foghorn';
import { useQuery } from '@tanstack/react-query';
import type { Concentration, TierCapture } from '@/lib/concentration';

/** A code line with a copy button. Local because it is used only here. */
function CopyRow({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 text-xs bg-[var(--bg-elevated)] rounded px-3 py-2 overflow-x-auto whitespace-pre">
        {text}
      </code>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(text).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            // Clipboard access can be denied; say so rather than showing a false success.
            () => setCopied(false)
          );
        }}
        className="px-2 py-1 text-xs rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] shrink-0"
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}

/** Compact age: "4m", "3h 12m", "1d 11h". */
function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'never';
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * Staleness judged against each source's OWN cadence, never a fixed number.
 *
 * The two feeds publish on completely different clocks — the oracle every 5 minutes with a
 * ~30-minute watermark, our probes on whatever `probe_interval_secs` the box is set to (3600 in
 * production). A single hardcoded threshold cannot serve both, and the first attempt proved it:
 * a 15-minute limit marked our own feed "lagging" for roughly 45 minutes out of every hour purely
 * because someone had configured hourly probing and the page didn't know.
 */
function staleness(source: FoghornQosSource): { variant: BadgeVariant; label: string } {
  const age = source.age_seconds;
  if (age === null) return { variant: 'default', label: 'no data' };
  // Relative to the source's own cadence, never a hardcoded number. A fixed 15-minute threshold
  // labelled our own feed "lagging" for ~45 minutes out of every hour, because the box probes
  // hourly — the page was crying wolf about itself. Two missed intervals is late; four is broken.
  const ours = source.source === 'lodestar-oracle' || source.source === 'foghorn';
  const interval = source.expected_interval_seconds ?? (ours ? 3600 : 300);
  const warn = interval * 2;
  const bad = interval * 4;
  if (age >= bad) return { variant: 'error', label: 'stalled' };
  if (age >= warn) return { variant: 'warning', label: 'lagging' };
  return { variant: 'success', label: 'live' };
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;
}

/** Sub-scores are 0..100, or null when the component had nothing to score. */
function sub(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toFixed(0);
}

function ms(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v)}ms`;
}

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-mid)',
    borderRadius: 'var(--radius-button)',
    color: 'var(--text)',
    fontSize: 12,
  },
  labelStyle: { color: 'var(--text)' },
  itemStyle: { color: 'var(--text-muted)' },
};

const TIER_COLOR: Record<TierCapture['tier'], string> = {
  zero: 'var(--red)',
  low: 'var(--amber)',
  unscored: 'var(--text-faint)',
  fair: 'var(--accent)',
  good: 'var(--green)',
};

const fmtGrt = (g: number) =>
  g >= 1e6 ? `${(g / 1e6).toFixed(1)}M` : g >= 1e3 ? `${(g / 1e3).toFixed(0)}K` : g.toFixed(0);

function ConcStat({
  label,
  value,
  sub,
  bad,
}: {
  label: string;
  value: string;
  sub?: string;
  bad?: boolean;
}) {
  return (
    <div className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2.5">
      <p className="text-[10px] text-[var(--text-faint)] mb-0.5">{label}</p>
      <p className={cn('text-lg font-semibold font-mono', bad ? 'text-[var(--red)]' : 'text-[var(--text)]')}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-[var(--text-faint)] mt-0.5">{sub}</p>}
    </div>
  );
}

const PAGE_SIZE = 25;

/**
 * Probes on an indexer before its grade is worth reading.
 *
 * Not a scoring threshold — the score itself makes no claim about sample size, and inventing one
 * in Rust would just move the arbitrariness somewhere less visible. It is a reader's warning: four
 * successful probes and an A look identical to six hundred and an A in a sorted table, and they
 * are not the same statement.
 */
const THIN_EVIDENCE_PROBES = 50;

/**
 * Corroborated responses before the correctness figure is worth reading as more than an anecdote.
 *
 * Corroboration only happens when several indexers answer the *identical* block-pinned probe, which
 * gateway routing rarely arranged. Direct paid dispatch is the first time we choose who answers, so
 * this number is expected to climb; the copy below reads differently either side of the threshold
 * rather than describing every sample size as small.
 */
const CORROBORATION_CONFIDENT = 500;

const GRAPHQL_EXAMPLE = `# Your existing QoS oracle query, unchanged.
# Only the endpoint differs.
{
  indexer(id: "0xyour-address") {
    allocationDailyDataPoints(first: 100) {
      subgraph_deployment_ipfs_hash
      proportion_indexer_200_responses
      avg_indexer_latency_ms
      avg_indexer_blocks_behind
      correctness_rate   # Lodestar addition: was the data RIGHT?
    }
  }
}`;

const REST_ENDPOINTS: { path: string; what: string }[] = [
  {
    path: 'GET /api/foghorn/qos/status',
    what: 'Age of both feeds. The one endpoint worth alerting on.',
  },
  {
    path: 'GET /api/foghorn/qos/buckets?indexer=0x…&hours=24',
    what: '5-minute resolution, including latency percentiles. Optional deployment= filter.',
  },
  {
    path: 'GET /api/foghorn/qos/compare?days=3',
    what: "Per-allocation agreement with Edge & Node's oracle, plus its blind spots.",
  },
  {
    path: 'GET /api/foghorn/indexer/0x…/allocations-qos',
    what: 'Both sources side by side for one indexer, each labelled with its provenance.',
  },
];

// These describe the Lodestar Oracle (gateway_id: lodestar). Edge & Node's feed uses the same field
// names with different meanings — `query_count` there is real routed traffic, not probes — so each
// row says which oracle it is talking about.
const FIELD_MAPPING: { field: string; meaning: string }[] = [
  {
    field: 'query_count',
    meaning:
      'Lodestar Oracle: probes we dispatched, never a measure of demand. Edge & Node: real queries their gateway routed.',
  },
  {
    field: 'proportion_indexer_200_responses',
    meaning: 'Share of probes answered 200 with no transport or GraphQL error.',
  },
  {
    field: 'avg_indexer_latency_ms',
    meaning: 'Mean over successful probes only, weighted by successes when rolled up to a day.',
  },
  {
    field: 'avg_indexer_blocks_behind',
    meaning:
      "The indexer's reported head against chainhead at probe time. We resolve the reference; the position is their claim, so an indexer misreporting its head would read as fresh.",
  },
  {
    field: 'avg_query_fee / total_query_fees',
    meaning: 'Always null. Paid probes now carry a TAP receipt with a real value, but the rollup does not record what we spent, so this stays unmeasured rather than reporting a zero we did not verify.',
  },
  {
    field: 'correctness_rate',
    meaning:
      'A Lodestar addition that no traffic census can produce. Share of comparable responses matching the stake-weighted majority. Null when nothing was comparable; never read null as 100%.',
  },
  {
    field: 'gateway_id',
    meaning: '"lodestar" on every row. The oracle format carries this so several gateways can publish.',
  },
];

export default function QosPage() {
  const [hours, setHours] = useState<6 | 24 | 168>(24);
  const [page, setPage] = useState(0);
  const [scorePage, setScorePage] = useState(0);
  const { data: status, isLoading: statusLoading, isError: statusError } = useQosStatus();
  const { data: buckets, isLoading: bucketsLoading } = useQosBuckets(hours);
  const { data: compare, isLoading: compareLoading } = useQosCompare();

  // Name enrichment. Raw hex addresses and Qm… hashes are unreadable, and both lookups already
  // exist: `/v1/indexers` returns ens_name in batch (same queryKey as the rest of the site, so this
  // is usually a cache hit), and useDeploymentNames batch-resolves subgraph names.
  const { data: roster } = useFoghornIndexers();
  const { data: capture } = useQuery<{
    data: { concentration: Concentration; coverage: { allocated_indexers: number; measured_indexers: number } };
  }>({
    queryKey: ['qos', 'capture'],
    queryFn: async () => {
      const r = await fetch('/api/qos/capture');
      if (!r.ok) throw new Error('capture unavailable');
      return r.json();
    },
    staleTime: 15 * 60_000,
    retry: 0,
  });
  const conc = capture?.data.concentration;
  const captureCoverage = capture?.data.coverage;
  const indexerNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const ix of roster?.indexers ?? []) {
      if (ix.ens_name) m.set(ix.indexer_address.toLowerCase(), ix.ens_name);
    }
    return m;
  }, [roster]);

  const deploymentHashes = useMemo(
    () => (buckets?.buckets ?? []).map((b) => b.subgraph_deployment_ipfs_hash),
    [buckets]
  );
  const { data: deploymentNames } = useDeploymentNames(deploymentHashes);

  /** ENS name if we have one, otherwise a shortened address — never a bare 42-char hex string. */
  const nameOf = (addr: string) => indexerNames.get(addr.toLowerCase()) ?? shortenAddress(addr);
  const deploymentLabel = (hash: string) => deploymentNames?.[hash] ?? `${hash.slice(0, 10)}…`;

  // Ours is `lodestar-oracle`; it answered to `foghorn` before the rename, and a deploy skew of a
  // few minutes should not blank the headline card.
  const isOurs = (s: FoghornQosSource) =>
    s.source === 'lodestar-oracle' || s.source === 'foghorn';
  const oracle = status?.sources.find((s) => !isOurs(s));
  const measured = status?.sources.find(isOurs);

  /**
   * Roll buckets up per (indexer, deployment) for display.
   *
   * Success rate is probe-weighted and latency is weighted by *successful* probes, matching how
   * the API rolls buckets into daily figures. Percentiles are deliberately not aggregated here:
   * they do not recombine, so the table shows the most recent bucket's p95 rather than inventing
   * a window figure. `correctness_rate` stays null when nothing was comparable — rendering that
   * as 100% would turn "we did not check" into "verified correct".
   */
  const rows = useMemo(() => {
    if (!buckets?.buckets?.length) return [];
    type Agg = {
      key: string;
      indexer: string;
      deployment: string;
      probes: number;
      ok: number;
      latWeighted: number;
      latWeight: number;
      p95: number | null;
      newest: string;
      blocksBehind: number | null;
      comparable: number;
      divergent: number;
    };
    const map = new Map<string, Agg>();
    for (const b of buckets.buckets) {
      const key = `${b.indexer_wallet}|${b.subgraph_deployment_ipfs_hash}`;
      const cur = map.get(key);
      const agg: Agg =
        cur ??
        {
          key,
          indexer: b.indexer_wallet,
          deployment: b.subgraph_deployment_ipfs_hash,
          probes: 0,
          ok: 0,
          latWeighted: 0,
          latWeight: 0,
          p95: null,
          newest: b.bucket_start,
          blocksBehind: null,
          comparable: 0,
          divergent: 0,
        };
      agg.probes += b.query_count;
      agg.ok += b.num_indexer_200_responses;
      if (b.avg_indexer_latency_ms !== null && b.num_indexer_200_responses > 0) {
        agg.latWeighted += b.avg_indexer_latency_ms * b.num_indexer_200_responses;
        agg.latWeight += b.num_indexer_200_responses;
      }
      // Buckets arrive newest-first, so the first sighting is the freshest.
      if (b.bucket_start >= agg.newest) {
        agg.newest = b.bucket_start;
        agg.p95 = b.latency_p95_ms;
        if (b.avg_indexer_blocks_behind !== null) agg.blocksBehind = b.avg_indexer_blocks_behind;
      }
      agg.comparable += b.comparable_count;
      agg.divergent += b.divergent_count;
      map.set(key, agg);
    }
    return [...map.values()]
      .map((a) => ({
        ...a,
        successRate: a.probes > 0 ? a.ok / a.probes : null,
        avgLatency: a.latWeight > 0 ? a.latWeighted / a.latWeight : null,
        correctness: a.comparable > 0 ? 1 - a.divergent / a.comparable : null,
      }))
      .sort((x, y) => {
        // Worst-first: an operator opens this page to find what is broken, not to admire the
        // healthy majority. Nulls sort last so "unmeasured" never masquerades as "failing".
        const a = x.successRate ?? 2;
        const b = y.successRate ?? 2;
        return a - b;
      });
  }, [buckets]);

  /**
   * Network-wide series over the window, one point per 5-minute bucket.
   *
   * Success is probe-weighted across indexers and latency is weighted by successful probes, so a
   * bucket where one indexer was probed twice does not count the same as one where ten were. This
   * is an average over *probed allocations*, not over traffic — nobody should read it as a
   * network-wide user experience figure.
   */
  const series = useMemo(() => {
    const byBucket = new Map<string, { ok: number; probes: number; lat: number; latW: number }>();
    for (const b of buckets?.buckets ?? []) {
      const cur = byBucket.get(b.bucket_start) ?? { ok: 0, probes: 0, lat: 0, latW: 0 };
      cur.ok += b.num_indexer_200_responses;
      cur.probes += b.query_count;
      if (b.avg_indexer_latency_ms !== null && b.num_indexer_200_responses > 0) {
        cur.lat += b.avg_indexer_latency_ms * b.num_indexer_200_responses;
        cur.latW += b.num_indexer_200_responses;
      }
      byBucket.set(b.bucket_start, cur);
    }
    return [...byBucket.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, v]) => ({
        t: new Date(bucket).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        success: v.probes > 0 ? Number(((v.ok / v.probes) * 100).toFixed(1)) : null,
        latency: v.latW > 0 ? Math.round(v.lat / v.latW) : null,
      }));
  }, [buckets]);

  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  /** CSV of the aggregated view, not the raw buckets — what is on screen is what gets exported. */
  const exportCsv = () => {
    const head = [
      'indexer', 'ens_name', 'deployment', 'success_rate', 'correctness_rate',
      'avg_latency_ms', 'p95_latest_ms', 'blocks_behind', 'probes',
    ].join(',');
    const body = rows.map((r) =>
      [
        r.indexer,
        indexerNames.get(r.indexer.toLowerCase()) ?? '',
        r.deployment,
        r.successRate ?? '',
        r.correctness ?? '',
        r.avgLatency === null ? '' : Math.round(r.avgLatency),
        r.p95 ?? '',
        r.blocksBehind === null ? '' : Math.round(r.blocksBehind),
        r.probes,
      ].join(',')
    );
    return [head, ...body].join('\n');
  };

  /**
   * Indexer quality, scored on Lodestar's own measurements.
   *
   * This is what /indexer-qos used to show, except its score came from Edge & Node's oracle. Ours
   * now runs on correctness, availability, freshness and coverage — all measured here. Not because
   * their numbers are bad, but because a score should be able to say where it came from, and one
   * blended from two instruments measuring different populations cannot.
   */
  const scoredIndexers = useMemo(() => {
    const list = (roster?.indexers ?? []).filter((ix) => ix.rated);
    return [...list].sort((a, b) => b.composite - a.composite);
  }, [roster]);
  const scorePageRows = scoredIndexers.slice(scorePage * PAGE_SIZE, (scorePage + 1) * PAGE_SIZE);

  const divergentRows = rows.filter((r) => (r.correctness ?? 1) < 1);
  /**
   * Total corroborated responses. Correctness requires two or more indexers answering the identical
   * probe; with gateway dispatch that is uncommon, so this is frequently zero — and a zero
   * "serving wrong data" count then means "nothing was checked", not "everything is fine". The UI
   * has to say which, or it flatters the network by accident.
   */
  const comparableTotal = useMemo(
    () => (buckets?.buckets ?? []).reduce((n, b) => n + b.comparable_count, 0),
    [buckets]
  );
  const divergentTotal = useMemo(
    () => (buckets?.buckets ?? []).reduce((n, b) => n + b.divergent_count, 0),
    [buckets]
  );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold">The Lodestar Oracle</h1>
          <Badge variant="accent">gateway_id: lodestar</Badge>
          <Badge variant="default">no API key</Badge>
        </div>
        <p className="text-sm text-[var(--text-muted)] max-w-3xl">
          An independent QoS oracle for The Graph, built on active probing rather than gateway
          telemetry. Every number below was measured here. It is served in the QoS oracle&apos;s own
          schema (<code>gateway_id</code> is on every data point because the format was built for
          several gateways), so an existing consumer query works against it unchanged, with no API
          key and nobody&apos;s gateway in the read path.
        </p>
        <p className="text-sm text-[var(--text-muted)] max-w-3xl">
          There is no canonical QoS oracle. There is this one and there is Edge &amp; Node&apos;s,
          and they are not the same instrument: theirs counts what their gateway actually routed:
          real traffic, real fees, real demand, while this one probes deliberately and can tell you
          whether a response was <em>correct</em>, which no traffic census can. Lodestar mirrored and
          served their feed until 2026-08-05 and has stopped. Their numbers are still read here for
          one purpose: comparing ours against a second opinion, below.
        </p>
        <p className="text-xs text-[var(--text-muted)] max-w-3xl">
          What this oracle cannot produce: query volume, fees, or any measure of demand. Probes are
          not traffic. Where a figure is unmeasured this page says so rather than showing a
          comfortable zero.
        </p>
      </header>

      {/* The headline: how old is each feed. */}
      <StatGrid>
        <StatCard
          label="Edge & Node oracle"
          value={formatAge(oracle?.age_seconds)}
          subtitle={oracle ? 'since last publish' : 'not ingested'}
          tag={oracle ? staleness(oracle).label : undefined}
          tooltip={oracle?.note}
          loading={statusLoading}
        />
        <StatCard
          label="Lodestar Oracle"
          value={formatAge(measured?.age_seconds)}
          subtitle={
            measured?.expected_interval_seconds
              ? `since last probe · runs every ${Math.round(measured.expected_interval_seconds / 60)}m`
              : 'since last measurement'
          }
          tag={measured ? staleness(measured).label : undefined}
          tooltip={measured?.note}
          loading={statusLoading}
        />
        <StatCard
          label="Allocations measured"
          value={String(rows.length)}
          subtitle={`last ${hours}h`}
          loading={bucketsLoading}
        />
        <StatCard
          label="Divergent responses"
          value={comparableTotal === 0 ? '—' : `${divergentTotal}/${comparableTotal}`}
          subtitle={
            comparableTotal === 0
              ? 'nothing corroborated yet'
              : `over ${comparableTotal} corroborated response${comparableTotal === 1 ? '' : 's'}`
          }
          tooltip={
            /* Scaled to the actual sample rather than fixed prose. The "with this few" wording was
               hardcoded, so it would have gone on calling ten thousand corroborated responses a
               small sample forever — the same way the bias caveat quietly went false once paid
               dispatch shipped. A caveat nobody complains about is one nobody notices is wrong. */
            comparableTotal === 0
              ? 'Correctness needs two or more indexers answering the identical probe, and until direct paid dispatch we could not choose who answered. Nothing has been checked yet: this is "not established", not "all clean".'
              : comparableTotal < CORROBORATION_CONFIDENT
                ? `A response that disagreed with a majority of at least two other indexers on the same probe. Over only ${comparableTotal} corroborated response${comparableTotal === 1 ? '' : 's'} this is an observation, not a verdict on any operator. Edge & Node's oracle cannot see it at all, which is why it is worth showing even while thin.`
                : `A response that disagreed with a majority of at least two other indexers on the same probe, over ${comparableTotal.toLocaleString()} corroborated responses. No traffic census can produce this signal: counting HTTP 200s cannot tell a correct answer from a confident wrong one.`
          }
          loading={bucketsLoading}
        />
      </StatGrid>

      {statusError && (
        <Card>
          <CardContent className="text-sm text-[var(--text-muted)]">
            The oracle&apos;s API is unreachable. The feed may be fine; this page is not.
          </CardContent>
        </Card>
      )}

      {/* The caveat, in the UI rather than a footnote. */}
      {buckets && (
        <Card>
          <CardContent className="text-xs text-[var(--text-muted)] space-y-1">
            <div>
              <span className="text-[var(--amber)]">Read this before comparing volumes:</span>{' '}
              {buckets.query_count_means}. It reflects our probe cadence, not demand.
            </div>
            <div>Method: {buckets.method}.</div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2">
        {([6, 24, 168] as const).map((h) => (
          <button
            key={h}
            onClick={() => { setHours(h); setPage(0); }}
            className={cn(
              'px-3 py-1 text-xs rounded border transition-colors',
              hours === h
                ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
            )}
          >
            {h === 168 ? '7d' : `${h}h`}
          </button>
        ))}
      </div>

      {/* ── Paid direct probing: a fact about us, not about them ── */}
      {status?.paid_dispatch && (
        <Card>
          <CardHeader>
            <CardTitle>Direct paid probing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-[var(--text-muted)]">
              Most quality feeds for The Graph, including ours until recently, reach indexers through
              a gateway. That gateway picks who answers, and it picks indexers it already believes
              are healthy, so the failures it avoids are invisible and any success rate built on it
              is a ceiling. Paying indexers directly with TAP receipts removes that: we choose who
              answers, so an indexer that would fail is observed failing.
            </p>
            <StatGrid>
              <StatCard
                label="Served"
                value={status.paid_dispatch.served.toLocaleString()}
                subtitle={`paid probes answered · last ${status.paid_dispatch.window_hours}h`}
                tag={status.paid_dispatch.served > 0 ? 'live' : undefined}
              />
              <StatCard
                label="Refused: no escrow seen"
                value={status.paid_dispatch.refused_denylisted.toLocaleString()}
                subtitle="their agent has not observed our deposit"
              />
              <StatCard
                label="Refused: unfunded"
                value={status.paid_dispatch.refused_unfunded.toLocaleString()}
                subtitle="we hold no escrow with them"
              />
            </StatGrid>
            <p className="text-xs text-[var(--text-muted)]">
              <span className="text-[var(--amber)]">Refusals are our problem, not theirs.</span>{' '}
              An indexer refuses because its tap-agent has not yet seen our escrow deposit on-chain,
              which is a propagation delay on their side of a payment we made on ours. It says
              nothing about how well they serve queries, so refusals are excluded from every number
              and every grade on this page rather than counted as failures. They are shown here
              because a reader deserves to know how much of this oracle&apos;s coverage is currently
              direct. Today, most of it is not.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Indexer quality, on our own numbers ── */}
      <Card>
        <CardHeader>
          <CardTitle>Indexer quality, scored on Lodestar&apos;s measurements</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-[var(--text-muted)]">
            Composite of four things we measure ourselves: correctness (0.40), availability (0.30),
            freshness (0.20) and coverage (0.10). No sub-score, verdict or alert reads anyone
            else&apos;s feed, so a stall upstream leaves every number here untouched.
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            Only indexers Lodestar has actually probed appear. That is the whole list: roughly a
            third of the active set, not all of it. An indexer missing from this table has not been
            judged and found wanting; it has not been judged.
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            A fifth component, query volume, was removed rather than left at zero. Volume is{' '}
            <em>demand</em>, a fact about which indexers a gateway chose to route to, and no amount
            of probing reproduces it. Scoring operators on a number we cannot measure, from a feed
            that had been stale for a month, was rewarding and punishing them for our blind spot.
          </p>

          {scoredIndexers.length === 0 ? (
            <div className="text-sm text-[var(--text-muted)]">
              No rated indexers yet. Scoring needs enough probes to be meaningful.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
                    <th className="py-2 pr-4">Indexer</th>
                    <th className="py-2 pr-4">Grade</th>
                    <th className="py-2 pr-4 text-right">Score</th>
                    <th className="py-2 pr-4 text-right">Correct</th>
                    <th className="py-2 pr-4 text-right">Available</th>
                    <th className="py-2 pr-4 text-right">Fresh</th>
                    <th className="py-2 pr-4 text-right">Coverage</th>
                    <th className="py-2 pr-4 text-right">Probes</th>
                  </tr>
                </thead>
                <tbody>
                  {scorePageRows.map((ix) => (
                    <tr
                      key={ix.indexer_address}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-elevated)]"
                    >
                      <td className="py-2 pr-4">
                        <Link
                          href={`/indexers/${ix.indexer_address}`}
                          className="text-[var(--accent)] hover:underline text-xs"
                          title={ix.indexer_address}
                        >
                          {ix.ens_name ?? shortenAddress(ix.indexer_address)}
                        </Link>
                        {ix.sybil_flag && (
                          <Badge variant="warning" className="ml-2">
                            sybil
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={gradeVariant(ix.grade)}>{ix.grade}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-right">{ix.composite.toFixed(1)}</td>
                      <td className="py-2 pr-4 text-right">{sub(ix.sub_scores.correctness)}</td>
                      <td className="py-2 pr-4 text-right">{sub(ix.sub_scores.availability)}</td>
                      <td className="py-2 pr-4 text-right">{sub(ix.sub_scores.freshness)}</td>
                      <td className="py-2 pr-4 text-right">{sub(ix.sub_scores.coverage)}</td>
                      <td
                        className={cn(
                          'py-2 pr-4 text-right',
                          ix.probe_count < THIN_EVIDENCE_PROBES
                            ? 'text-[var(--amber)]'
                            : 'text-[var(--text-muted)]'
                        )}
                        title={
                          ix.probe_count < THIN_EVIDENCE_PROBES
                            ? `Only ${ix.probe_count} probes, so this grade is a weak signal rather than a verdict`
                            : undefined
                        }
                      >
                        {ix.probe_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                page={scorePage}
                pageSize={PAGE_SIZE}
                totalItems={scoredIndexers.length}
                onPageChange={setScorePage}
              />
            </div>
          )}
          <div className="text-xs text-[var(--text-muted)] space-y-1">
            <p>
              A dash means that component had nothing to score, never that it scored zero. Freshness
              is dashed most often: it now comes only from chainhead lag we measured ourselves, where
              it used to fall back to the oracle&apos;s figure, which reads as pristine and was last
              written on 1 July.
            </p>
            <p>
              A probe count in amber is under {THIN_EVIDENCE_PROBES}. The grade is computed the same
              way, but a sorted table makes an A off four probes look like an A off six hundred, and
              it is not the same claim.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Where the rewards actually sit, against measured quality ── */}
      {conc && conc.totalAllocatedGrt > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle>Allocated stake by measured quality</CardTitle>
              <span className="text-[11px] text-[var(--text-faint)]">
                {fmtGrt(conc.totalAllocatedGrt)} GRT allocated · {conc.indexerCount} indexers
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-[var(--text-muted)]">
              Allocated stake earns indexing rewards. This is how it splits across the quality bands
              the Lodestar Oracle measured, which is a different question from how much stake exists,
              and the one that says whether rewards are reaching indexers who serve.
            </p>

            <div className="flex w-full h-8 rounded-lg overflow-hidden border border-[var(--border)]">
              {conc.tiers.map((tier) => (
                <div
                  key={tier.tier}
                  style={{ width: `${tier.alloc_share * 100}%`, backgroundColor: TIER_COLOR[tier.tier] }}
                  className="h-full"
                  title={`${tier.label}: ${(tier.alloc_share * 100).toFixed(1)}% · ${tier.indexers} indexers · ${fmtGrt(tier.alloc_grt)} GRT`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {conc.tiers.map((tier) => (
                <div key={tier.tier} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: TIER_COLOR[tier.tier] }} />
                  <span className="text-[11px] text-[var(--text-muted)]">{tier.label}</span>
                  <span className="text-[11px] font-mono text-[var(--text)]">
                    {(tier.alloc_share * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <ConcStat
                label="Measured low-value"
                value={`${(conc.lowValueShare * 100).toFixed(0)}%`}
                sub={`${fmtGrt(conc.lowValueGrt)} GRT scored under 30`}
                bad={conc.lowValueShare > 0.2}
              />
              <ConcStat
                label="Not measured"
                value={`${(conc.unmeasuredShare * 100).toFixed(0)}%`}
                sub={`${fmtGrt(conc.unmeasuredGrt)} GRT we have not probed`}
              />
              <ConcStat
                label={`Top ${conc.topN} share`}
                value={`${(conc.topNShare * 100).toFixed(0)}%`}
                sub="stake concentration"
                bad={conc.topNShare > 0.5}
              />
              <ConcStat
                label="Gini / Nakamoto"
                value={`${conc.gini.toFixed(2)} / ${conc.nakamoto}`}
                sub="inequality · entities >50%"
              />
            </div>

            <p className="text-xs text-[var(--text-muted)]">
              <span className="text-[var(--amber)]">Read the grey band carefully.</span> &quot;Not
              measured&quot; is stake behind indexers this oracle has not probed
              {captureCoverage && (
                <>
                  {' '}
                  · {captureCoverage.measured_indexers} of {captureCoverage.allocated_indexers}{' '}
                  allocated indexers have been
                </>
              )}
              . It is a gap in our coverage, not a finding about them, and it is deliberately kept out
              of the low-value figure. An earlier version of this chart counted unscored stake as
              crowding-out, which quietly turned &quot;we did not look&quot; into an accusation.
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Concentration figures (Gini, Nakamoto, top-{conc.topN}) are computed over allocated
              stake alone and involve no quality measurement at all, so they cover the whole network
              regardless of what we probed.
            </p>
          </CardContent>
        </Card>
      )}

      {series.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Lodestar&apos;s own measurements over the window</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-xs text-[var(--text-muted)] mb-2">Success rate (%)</div>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                    <Tooltip {...TOOLTIP_STYLE} />
                    <Line
                      type="monotone"
                      dataKey="success"
                      stroke="var(--green)"
                      dot={false}
                      strokeWidth={2}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)] mb-2">Avg latency (ms)</div>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                    <Tooltip {...TOOLTIP_STYLE} />
                    <Line
                      type="monotone"
                      dataKey="latency"
                      stroke="var(--accent)"
                      dot={false}
                      strokeWidth={2}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-3">
              Averaged across probed allocations, weighted by probe count, not by real
              traffic, so this is not a network-wide user-experience figure. Gaps are buckets with no
              probes, left broken rather than interpolated.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle>Lodestar&apos;s own measurements, worst first</CardTitle>
            <ExportButton
              onExport={exportCsv}
              filename={`foghorn-qos-${hours}h.csv`}
              disabled={rows.length === 0}
            />
          </div>
        </CardHeader>
        <CardContent>
          {bucketsLoading ? (
            <div className="text-sm text-[var(--text-muted)]">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-[var(--text-muted)]">
              No measurements in this window yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
                    <th className="py-2 pr-4">Indexer</th>
                    <th className="py-2 pr-4">Deployment</th>
                    <th className="py-2 pr-4 text-right">Success</th>
                    <th className="py-2 pr-4 text-right">Correct</th>
                    <th className="py-2 pr-4 text-right">Avg latency</th>
                    <th className="py-2 pr-4 text-right">p95 (latest)</th>
                    <th className="py-2 pr-4 text-right">Blocks behind</th>
                    <th className="py-2 pr-4 text-right">Probes</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr
                      key={r.key}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-elevated)]"
                    >
                      <td className="py-2 pr-4">
                        <Link
                          href={`/indexers/${r.indexer}`}
                          className="text-[var(--accent)] hover:underline text-xs"
                          title={r.indexer}
                        >
                          {nameOf(r.indexer)}
                        </Link>
                      </td>
                      <td
                        className="py-2 pr-4 text-xs text-[var(--text-muted)] max-w-[18rem] truncate"
                        title={r.deployment}
                      >
                        <Link href={`/subgraphs/${r.deployment}`} className="hover:underline">
                          {deploymentLabel(r.deployment)}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <span
                          className={cn(
                            (r.successRate ?? 1) < 0.9 && 'text-[var(--red)]',
                            (r.successRate ?? 1) >= 0.99 && 'text-[var(--green)]'
                          )}
                        >
                          {pct(r.successRate)}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {r.correctness === null ? (
                          <span
                            className="text-[var(--text-muted)]"
                            title="Not checked: no comparable majority cluster in this window"
                          >
                            —
                          </span>
                        ) : (
                          <Badge variant={r.correctness < 1 ? 'error' : 'success'}>
                            {pct(r.correctness)}
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right">{ms(r.avgLatency)}</td>
                      <td className="py-2 pr-4 text-right text-[var(--text-muted)]">
                        {ms(r.p95)}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {r.blocksBehind === null ? '—' : Math.round(r.blocksBehind)}
                      </td>
                      <td className="py-2 pr-4 text-right text-[var(--text-muted)]">{r.probes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                totalItems={rows.length}
                onPageChange={setPage}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Do we agree with the other oracle? ── */}
      <Card>
        <CardHeader>
          <CardTitle>Agreement with Edge &amp; Node&apos;s oracle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-[var(--text-muted)]">
            If our numbers disagreed wildly with the oracle&apos;s, that would need explaining
            before anyone relied on this feed. So here is the check, run over the same trailing
            window the oracle&apos;s figures cover, on the {compare?.coverage.overlapping_pairs ?? 0}{' '}
            allocation{compare?.coverage.overlapping_pairs === 1 ? '' : 's'} both feeds cover.
          </p>

          {compareLoading ? (
            <div className="text-sm text-[var(--text-muted)]">Loading…</div>
          ) : !compare ? (
            <div className="text-sm text-[var(--text-muted)]">
              Comparison unavailable. It needs both feeds to have data for the same allocations.
            </div>
          ) : (
            <>
              <StatGrid>
                <StatCard
                  label="Mean disagreement"
                  value={
                    compare.agreement.mean_absolute_success_rate_error === null
                      ? '—'
                      : pct(compare.agreement.mean_absolute_success_rate_error)
                  }
                  subtitle={`success rate, ${compare.agreement.pairs_in_aggregate} pairs`}
                  tooltip={`Pairs with fewer than ${compare.min_probes_for_aggregate} probes are excluded: a success rate over a handful of probes is not evidence.`}
                />
                <StatCard
                  label="Disagree >10%"
                  value={String(compare.agreement.pairs_disagreeing_over_10pct)}
                  subtitle="allocations"
                />
                <StatCard
                  label="Oracle blind spots"
                  value={String(compare.agreement.oracle_blind_spots)}
                  subtitle="wrong data, scored 100%"
                  tooltip={compare.agreement.oracle_blind_spot_means}
                />
                <StatCard
                  label="Coverage overlap"
                  value={`${compare.coverage.overlapping_pairs}`}
                  subtitle={`of ${compare.coverage.foghorn_pairs} ours / ${compare.coverage.oracle_pairs} theirs`}
                  tooltip={compare.coverage.note}
                />
              </StatGrid>

              <p className="text-xs text-[var(--text-muted)]">
                <span className="text-[var(--amber)]">Disagreement is not automatically our
                error.</span>{' '}
                Their oracle sees real user traffic through one gateway; ours sees synthetic
                block-pinned probes from one location. Different query mixes, different geography,
                very different sample sizes. And {compare.not_compared.query_count}.
              </p>

              {compare.pairs.filter((p) => p.oracle_blind_spot).length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium">
                    Allocations their oracle scores well but ours caught serving wrong data
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                          <th className="py-2 pr-4">Indexer</th>
                          <th className="py-2 pr-4">Deployment</th>
                          <th className="py-2 pr-4 text-right">Oracle success</th>
                          <th className="py-2 pr-4 text-right">Our correctness</th>
                          <th className="py-2 pr-4 text-right">Probes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compare.pairs
                          .filter((p) => p.oracle_blind_spot)
                          .slice(0, 25)
                          .map((p) => (
                            <tr
                              key={`${p.indexer_address}|${p.deployment_id}`}
                              className="border-b border-[var(--border)] last:border-0"
                            >
                              <td className="py-2 pr-4">
                                <Link
                                  href={`/indexers/${p.indexer_address}`}
                                  className="text-[var(--accent)] hover:underline"
                                  title={p.indexer_address}
                                >
                                  {nameOf(p.indexer_address)}
                                </Link>
                              </td>
                              <td
                                className="py-2 pr-4 text-[var(--text-muted)] max-w-[16rem] truncate"
                                title={p.deployment_id}
                              >
                                {deploymentLabel(p.deployment_id)}
                              </td>
                              <td className="py-2 pr-4 text-right text-[var(--green)]">
                                {pct(p.oracle.success_rate)}
                              </td>
                              <td className="py-2 pr-4 text-right text-[var(--red)]">
                                {pct(p.foghorn.correctness_rate)}
                              </td>
                              <td className="py-2 pr-4 text-right text-[var(--text-muted)]">
                                {p.probes}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Methodology, stated plainly enough to argue with ── */}
      <Card>
        <CardHeader>
          <CardTitle>Methodology, including what we can&apos;t tell you</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <section className="space-y-1">
            <h3 className="font-medium">How the numbers are made</h3>
            <ul className="list-disc pl-5 space-y-1 text-[var(--text-muted)]">
              <li>
                We send GraphQL probes pinned to a specific block hash at chainhead − 12,
                so every indexer is asked the identical question about identical state.
              </li>
              <li>
                Responses are canonicalised with JCS (RFC 8785), hashed with SHA-256 and clustered.
                An indexer in the minority cluster returned confident, well-formed{' '}
                <em>wrong data</em>, the signal a 200-counting oracle cannot produce.
              </li>
              <li>
                Success rate counts HTTP 200s with no transport or GraphQL error. Latency covers{' '}
                <em>successful</em> probes only, because a fast 500 is not fast service and the
                failure is already counted once.
              </li>
              <li>
                Freshness is chainhead lag: the indexer&apos;s own reported head compared against
                chainhead at probe time, which we resolve ourselves rather than taking on trust.
                Clamped at zero, and conservative by a few seconds of block production, so it will not
                resolve a lag of tens of blocks on a sub-second chain, but an indexer hundreds or
                thousands of blocks behind measures cleanly.
              </li>
              <li>
                Measurements land in 5-minute buckets and are recomputed over a trailing window
                every minute, so a restart or a late arrival converges instead of leaving a hole.
              </li>
            </ul>
          </section>

          <section className="space-y-1">
            <h3 className="font-medium">Where this differs from Edge &amp; Node&apos;s oracle</h3>
            <ul className="list-disc pl-5 space-y-1 text-[var(--text-muted)]">
              <li>
                <strong>Probes, not traffic.</strong> Our <code>query_count</code> is how often we
                asked, not how popular an indexer is. Never read it as demand.
              </li>
              <li>
                <strong>One vantage point.</strong> One location, a fixed query set, no real user
                load. The oracle&apos;s census of live traffic is better at &quot;what did users
                actually experience&quot;; ours is better at &quot;is this indexer serving correct,
                fresh data right now&quot;.
              </li>
              <li>
                <span className="text-[var(--amber)]">How to read our success rate.</span>{' '}
                {/* Straight from the API, which computes it from the actual dispatch mix. This was
                    hand-written prose asserting that every probe went through Edge & Node's
                    gateway; that stopped being true the moment paid direct probing was switched on,
                    and nothing would have flagged it, because a caveat that is too harsh generates
                    no complaints. */}
                {buckets?.success_rate_bias ??
                  'Unknown until the feed reports its dispatch mix; treat the success rate as an upper bound.'}
                {buckets?.dispatch && (
                  <>
                    {' '}
                    Over the last {buckets.window_hours}h:{' '}
                    <strong>{buckets.dispatch.paid_direct.toLocaleString()}</strong> observations
                    paid for directly,{' '}
                    <strong>{buckets.dispatch.via_gateway.toLocaleString()}</strong> via the gateway.
                  </>
                )}{' '}
                Where the two feeds overlap our success rate has come out higher than Edge &amp;
                Node&apos;s, never lower, which is what selection bias looks like from the inside.
              </li>
              <li>
                <strong>Which fields are unaffected.</strong> Correctness is the genuinely
                independent one: responses are compared against each other, so nothing an indexer
                asserts about itself can move it. Blocks-behind is <em>partly</em> independent: we
                resolve chainhead ourselves, but the indexer&apos;s position is taken from its own{' '}
                <code>_meta</code>, so an operator misreporting its head would appear current.
                Success rate is the weakest of the three, for the selection-bias reason above.
              </li>
              <li>
                <span className="text-[var(--amber)]">Correctness is currently thin.</span> Judging a
                response requires at least two indexers answering the <em>identical</em> probe, and
                gateway dispatch seldom provides that corroboration, so most rows read{' '}
                <code>—</code>, meaning not established rather than clean. An earlier version scored
                a &quot;minority of one&quot; as wrong and briefly accused a named indexer on a
                sample where nothing had been compared; requiring a real majority fixed that and
                revealed how sparse the coverage actually is. Direct dispatch fixes the coverage.
              </li>
              <li>
                <strong>Percentiles only at bucket resolution.</strong> Percentiles don&apos;t
                recombine, so we publish p50/p95/p99 per 5-minute bucket and refuse to invent a
                daily figure.
              </li>
              <li>
                <strong>Nulls mean not measured.</strong> Correctness is null when nothing was
                comparable, never 100%. Fees are null until probes are TAP-paid, never zero.
              </li>
            </ul>
          </section>

          <section className="space-y-1">
            <h3 className="font-medium">What no feed of ours can ever tell you</h3>
            <ul className="list-disc pl-5 space-y-1 text-[var(--text-muted)]">
              <li>
                How many queries Edge &amp; Node&apos;s gateway sent <em>other</em> indexers. That
                is their gateway&apos;s private log.
              </li>
              <li>
                Why that gateway chose not to route to you. The selection reasoning is internal to
                it, and no amount of probing recovers a counterfactual.
              </li>
              <li>
                Your own traffic from that gateway, though that one isn&apos;t a mystery: it is in
                your <code>indexer-service</code> logs and your TAP receipts already.
              </li>
            </ul>
          </section>

          <section className="space-y-1">
            <h3 className="font-medium">Why this exists</h3>
            <p className="text-[var(--text-muted)]">
              On 2026-07-29 Edge &amp; Node&apos;s oracle stopped publishing for over 35 hours. The relayer
              was fine (funded, no failed transactions, no stuck nonce), so nothing on-chain
              revealed it, and every consumer kept serving stale numbers that looked current, this
              dashboard included.
            </p>
            <p className="text-[var(--text-muted)]">
              Watching for that turned up something larger. Since 2026-07-01 the oracle&apos;s
              main subgraph deployment (<code>Dtr9r…</code>) has rejected every message the publisher
              sends, with <code>&quot;… is not a valid submitter&quot;</code>. The publisher moved
              to a signer its allowlist does not carry, all while sitting at chain tip reporting no
              indexing errors. The posts keep arriving and none become data. Anyone querying that
              deployment has received 1 July figures ever since, with nothing in the response to
              say so.
            </p>
            <p className="text-[var(--text-muted)]">
              The data itself was never lost, and it is worth being precise about that. The
              publisher is live (you can watch it post to Gnosis at the top of this page) and a
              community fork of the subgraph (<code>CnfJ5…</code>, maintained by ellipfra) carries
              an updated allowlist and has indexed every message throughout. It is current to today.
              So the oracle is not down; one deployment of its subgraph is, and the consumers
              pointed at that deployment cannot tell.
            </p>
            <p className="text-[var(--text-muted)]">
              Which is the sharper version of the same problem. A stalled feed that announces itself
              is an outage. A stalled feed that answers every query with month-old numbers, at chain
              tip, with no indexing errors, while a working copy of the same data sits one subgraph
              id away, is a correctness failure that no amount of uptime monitoring finds.
            </p>
            <p className="text-[var(--text-muted)]">
              Hence the ages on the front of this page, and hence the parts below that say
              &quot;not measured&quot; rather than showing a comfortable zero.
            </p>
            <p className="text-[var(--text-muted)]">
              And hence, since 2026-08-05, no mirror. Lodestar held a copy of Edge &amp; Node&apos;s
              published history and served it, which sounded like resilience and was really a second
              way to hand people stale numbers with our name on them. Two oracles measuring the
              network independently is worth more than one oracle and a photocopy.
            </p>
          </section>
        </CardContent>
      </Card>

      {/* ── Use it: the drop-in claim, made checkable ── */}
      <Card>
        <CardHeader>
          <CardTitle>Using the feed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <section className="space-y-2">
            <h3 className="font-medium">GraphQL: a drop-in for the oracle subgraph</h3>
            <p className="text-[var(--text-muted)]">
              The endpoint reuses the QoS oracle&apos;s entities and field names, including{' '}
              <code>allocationDailyDataPoints</code>, <code>indexer(id:)</code>,{' '}
              <code>subgraphDeployment(id:)</code> and <code>queryDailyDataPoints</code>, with the
              same <code>where</code> filters (<code>dayNumber</code>,{' '}
              <code>dayNumber_gte</code>, <code>query_count_gte</code>, <code>id_gt</code>) and{' '}
              <code>orderBy</code>/<code>orderDirection</code>. <code>BigInt</code> and{' '}
              <code>BigDecimal</code> serialise as strings exactly as graph-node does. No API key.
            </p>
            <CopyRow text="POST https://www.lodestar-dashboard.com/api/foghorn/qos/graphql" />
            <pre className="text-xs bg-[var(--bg-elevated)] rounded p-3 overflow-x-auto">
              {GRAPHQL_EXAMPLE}
            </pre>
            <p className="text-xs text-[var(--text-muted)]">
              Additive fields only, so adopting it breaks nothing:{' '}
              <code>correctness_rate</code>, <code>comparable_count</code>,{' '}
              <code>divergent_count</code>, and <code>_foghornStatus</code> for feed age.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">REST, if you&apos;d rather not speak GraphQL</h3>
            <div className="space-y-2">
              {REST_ENDPOINTS.map((e) => (
                <div key={e.path} className="space-y-1">
                  <CopyRow text={e.path} />
                  <p className="text-xs text-[var(--text-muted)] pl-1">{e.what}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">Field mapping</h3>
            <p className="text-xs text-[var(--text-muted)]">
              What each field means on <strong>the Lodestar Oracle</strong>. Edge &amp; Node&apos;s
              feed uses the same names for different things, most importantly{' '}
              <code>query_count</code>, so a consumer switching between the two must reread this
              table, not assume it.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                    <th className="py-2 pr-4">Oracle field</th>
                    <th className="py-2 pr-4">What ours means</th>
                  </tr>
                </thead>
                <tbody>
                  {FIELD_MAPPING.map((f) => (
                    <tr key={f.field} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2 pr-4 font-mono">{f.field}</td>
                      <td className="py-2 pr-4 text-[var(--text-muted)]">{f.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
