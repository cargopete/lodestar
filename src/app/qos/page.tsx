'use client';

/**
 * The Free QoS — Foghorn's own quality-of-service feed.
 *
 * The headline is deliberately *freshness*, not any individual metric. On 2026-07-29 the
 * canonical oracle stopped publishing for 35 hours and no consumer could tell, because a stale
 * subgraph answers queries exactly like a fresh one. Putting both sources' ages at the top of
 * the page makes that failure visible the moment it happens, without anyone having to trust us.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { useQosStatus, useQosBuckets, useQosCompare } from '@/hooks/useFoghorn';
import type { BadgeVariant } from '@/components/ui/Badge';
import type { FoghornQosSource } from '@/lib/foghorn';
import { shortenAddress, cn } from '@/lib/utils';

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
 * Staleness thresholds differ per source *by design*, because their cadences do.
 *
 * The oracle batches with a ~30-minute watermark, so anything under an hour is normal for it and
 * would be alarming for us. Foghorn recomputes every minute and has nothing to wait for, so a
 * quarter of an hour already means something is wrong. Judging both against one threshold would
 * either cry wolf about theirs or excuse ours.
 */
function staleness(source: FoghornQosSource): { variant: BadgeVariant; label: string } {
  const age = source.age_seconds;
  if (age === null) return { variant: 'default', label: 'no data' };
  const measured = source.source === 'foghorn';
  const warn = measured ? 15 * 60 : 60 * 60;
  const bad = measured ? 60 * 60 : 3 * 60 * 60;
  if (age >= bad) return { variant: 'error', label: 'stalled' };
  if (age >= warn) return { variant: 'warning', label: 'lagging' };
  return { variant: 'success', label: 'live' };
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;
}

function ms(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v)}ms`;
}

const GRAPHQL_EXAMPLE = `# Your existing QoS oracle query, unchanged.
# Only the endpoint differs.
{
  indexer(id: "0xyour-address") {
    allocationDailyDataPoints(first: 100) {
      subgraph_deployment_ipfs_hash
      proportion_indexer_200_responses
      avg_indexer_latency_ms
      avg_indexer_blocks_behind
      correctness_rate   # Foghorn addition: was the data RIGHT?
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
    what: 'Per-allocation agreement with the canonical oracle, plus its blind spots.',
  },
  {
    path: 'GET /api/foghorn/indexer/0x…/allocations-qos',
    what: 'Both sources side by side for one indexer, each labelled with its provenance.',
  },
];

const FIELD_MAPPING: { field: string; meaning: string }[] = [
  {
    field: 'query_count',
    meaning: 'Probes Foghorn dispatched. NOT organic traffic, and never a measure of demand.',
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
    meaning: 'Chainhead lag resolved against a public Arbitrum RPC, not self-reported.',
  },
  {
    field: 'avg_query_fee / total_query_fees',
    meaning: 'Null until probes are TAP-paid. Null means not measured; zero would mean free.',
  },
  {
    field: 'correctness_rate',
    meaning:
      'Foghorn addition. Share of comparable responses matching the stake-weighted majority. Null when nothing was comparable — never read null as 100%.',
  },
  {
    field: 'gateway_id',
    meaning: '"lodestar" on every row. The oracle format carries this so several gateways can publish.',
  },
];

export default function QosPage() {
  const [hours, setHours] = useState<6 | 24 | 168>(24);
  const { data: status, isLoading: statusLoading, isError: statusError } = useQosStatus();
  const { data: buckets, isLoading: bucketsLoading } = useQosBuckets(hours);
  const { data: compare, isLoading: compareLoading } = useQosCompare();

  const oracle = status?.sources.find((s) => s.source !== 'foghorn');
  const measured = status?.sources.find((s) => s.source === 'foghorn');

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

  const divergentRows = rows.filter((r) => (r.correctness ?? 1) < 1);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold">The Free QoS</h1>
          <Badge variant="accent">gateway_id: lodestar</Badge>
          <Badge variant="default">no API key</Badge>
        </div>
        <p className="text-sm text-[var(--text-muted)] max-w-3xl">
          Quality-of-service that Foghorn measures itself, published in the canonical oracle&apos;s
          own schema. The oracle&apos;s format carries a <code>gateway_id</code> on every data
          point, so this is a second gateway in a format built for several — not a fork of it.
          Independent of Edge &amp; Node&apos;s pipeline, so it stays up when that stalls.
        </p>
      </header>

      {/* The headline: how old is each feed. */}
      <StatGrid>
        <StatCard
          label="Canonical oracle"
          value={formatAge(oracle?.age_seconds)}
          subtitle={oracle ? 'since last publish' : 'not ingested'}
          tag={oracle ? staleness(oracle).label : undefined}
          tooltip={oracle?.note}
          loading={statusLoading}
        />
        <StatCard
          label="Foghorn QoS"
          value={formatAge(measured?.age_seconds)}
          subtitle="since last measurement"
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
          label="Serving wrong data"
          value={String(divergentRows.length)}
          subtitle="minority-cluster responses"
          tooltip="The oracle cannot see this: it knows an indexer answered fast with a 200, not whether the answer was correct."
          loading={bucketsLoading}
        />
      </StatGrid>

      {statusError && (
        <Card>
          <CardContent className="text-sm text-[var(--text-muted)]">
            Foghorn API unreachable. The feed may be fine — this page is not.
          </CardContent>
        </Card>
      )}

      {/* The caveat, in the UI rather than a footnote. */}
      {buckets && (
        <Card>
          <CardContent className="text-xs text-[var(--text-muted)] space-y-1">
            <div>
              <span className="text-[var(--amber)]">Read this before comparing volumes:</span>{' '}
              {buckets.query_count_means}. It reflects Foghorn&apos;s probe cadence, not demand.
            </div>
            <div>Method: {buckets.method}.</div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2">
        {([6, 24, 168] as const).map((h) => (
          <button
            key={h}
            onClick={() => setHours(h)}
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

      <Card>
        <CardHeader>
          <CardTitle>Measured allocations — worst first</CardTitle>
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
                  {rows.map((r) => (
                    <tr
                      key={r.key}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-elevated)]"
                    >
                      <td className="py-2 pr-4">
                        <Link
                          href={`/indexers/${r.indexer}`}
                          className="text-[var(--accent)] hover:underline font-mono text-xs"
                        >
                          {shortenAddress(r.indexer)}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-[var(--text-muted)]">
                        <Link href={`/subgraphs/${r.deployment}`} className="hover:underline">
                          {r.deployment.slice(0, 10)}…
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
                            title="Not checked — no comparable majority cluster in this window"
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Do we agree with the canonical oracle? ── */}
      <Card>
        <CardHeader>
          <CardTitle>Agreement with the canonical oracle</CardTitle>
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
              Comparison unavailable — needs both feeds to have data for the same allocations.
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
                The oracle sees real user traffic through one gateway; Foghorn sees synthetic
                block-pinned probes from one location. Different query mixes, different geography,
                very different sample sizes. And {compare.not_compared.query_count}.
              </p>

              {compare.pairs.filter((p) => p.oracle_blind_spot).length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium">
                    Allocations the oracle scores well but Foghorn caught serving wrong data
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
                              <td className="py-2 pr-4 font-mono">
                                <Link
                                  href={`/indexers/${p.indexer_address}`}
                                  className="text-[var(--accent)] hover:underline"
                                >
                                  {shortenAddress(p.indexer_address)}
                                </Link>
                              </td>
                              <td className="py-2 pr-4 font-mono text-[var(--text-muted)]">
                                {p.deployment_id.slice(0, 10)}…
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
                Foghorn sends GraphQL probes pinned to a specific block hash at chainhead − 12,
                so every indexer is asked the identical question about identical state.
              </li>
              <li>
                Responses are canonicalised with JCS (RFC 8785), hashed with SHA-256 and clustered.
                An indexer in the minority cluster returned confident, well-formed{' '}
                <em>wrong data</em> — the signal a 200-counting oracle cannot produce.
              </li>
              <li>
                Success rate counts HTTP 200s with no transport or GraphQL error. Latency covers{' '}
                <em>successful</em> probes only, because a fast 500 is not fast service and the
                failure is already counted once.
              </li>
              <li>
                Freshness is chainhead lag resolved against a public Arbitrum RPC, not
                self-reported.
              </li>
              <li>
                Measurements land in 5-minute buckets and are recomputed over a trailing window
                every minute, so a restart or a late arrival converges instead of leaving a hole.
              </li>
            </ul>
          </section>

          <section className="space-y-1">
            <h3 className="font-medium">Where this differs from the canonical oracle</h3>
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
                Your own traffic from that gateway — but that one isn&apos;t a mystery: it is in
                your <code>indexer-service</code> logs and your TAP receipts already.
              </li>
            </ul>
          </section>

          <section className="space-y-1">
            <h3 className="font-medium">Why this exists</h3>
            <p className="text-[var(--text-muted)]">
              On 2026-07-29 the canonical oracle stopped publishing for over 35 hours. Its
              publisher had been running with a steady 30-minute lag for hours, slipped to 48
              minutes, then died between the two halves of a single 5-minute bucket. The relayer
              was fine — funded, no failed transactions, no stuck nonce — so nothing on-chain
              revealed it. Every consumer kept serving stale numbers that looked current, this
              dashboard included. A feed with fewer moving parts and its own age on the front
              cannot fail that quietly.
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
            <h3 className="font-medium">GraphQL — drop-in for the oracle subgraph</h3>
            <p className="text-[var(--text-muted)]">
              The endpoint mirrors the oracle&apos;s entities and field names, including{' '}
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
