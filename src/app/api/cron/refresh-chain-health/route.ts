import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet } from '@/lib/cache';
import { log } from '@/lib/logger';
import type { EnrichedIndexer } from '@/lib/enriched';
import {
  advanceChainHead,
  classifyLiveness,
  type ChainHeadRecord,
  type ChainLiveness,
} from '@/lib/chain-liveness';

// ---------------------------------------------------------------------------
// Exported types (consumed by /api/chain-lag and /api/dropped-chains)
// ---------------------------------------------------------------------------

export interface ChainStats {
  medianBlocksBehind: number;
  sampledIndexers: number;
  laggingCount: number;
  /**
   * Whether the chain is still producing blocks. `medianBlocksBehind` measures
   * distance to head and therefore reports zero for a chain that has stopped —
   * every indexer is exactly at a head that no longer moves. This is the
   * absolute signal that survives that. See lib/chain-liveness.
   */
  liveness: ChainLiveness;
  /** Highest block observed for this chain across sampled indexers. */
  observedHead: number | null;
  /** How long we watched the head fail to advance. Zero for a live chain. */
  headStalledForMs: number;
}

/** Per-chain head history, persisted across cron runs. Keyed by network name. */
export type ChainHeadRecords = Record<string, ChainHeadRecord>;

/**
 * Head history must outlive the 2h chain-lag TTL by a wide margin: if it expires
 * the stall clock resets and a chain that has been dead for days reads as live
 * again on the next run.
 */
const HEAD_RECORD_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface ChainLagData {
  chains: Record<string, ChainStats>;
  computedAt: number;
}

export interface IndexerChainSnapshot {
  current: string[];
  previous: string[] | null;
  capturedAt: number;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

// ---------------------------------------------------------------------------
// SSRF guard (identical to indexer-node-health route)
// ---------------------------------------------------------------------------

function isSafeUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost') return false;
    if (/^127\./.test(host)) return false;
    if (/^10\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^169\.254\./.test(host)) return false;
    if (host === '::1' || host === '[::1]') return false;
    if (/^fc|^fd/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Per-indexer node fetch
// ---------------------------------------------------------------------------

interface DeploymentStatus {
  network: string;
  blocksBehind: number | null; // null = uncapped noise or unknown
  synced: boolean;
  failed: boolean;
  /**
   * The tip this node reports for the chain, independent of how far this
   * particular deployment has indexed. Feeds liveness tracking.
   */
  chainHead: number | null;
}

async function fetchIndexerDeployments(indexerUrl: string): Promise<DeploymentStatus[]> {
  const base = indexerUrl.replace(/\/+$/, '');
  const query = `{
    indexingStatuses {
      synced
      health
      chains {
        network
        ... on EthereumIndexingStatus {
          chainHeadBlock { number }
          latestBlock { number }
        }
      }
    }
  }`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(`${base}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });

    if (!res.ok) return [];

    const json = await res.json();
    const statuses: Array<{
      synced: boolean;
      health: string;
      chains?: Array<{
        network?: string;
        chainHeadBlock?: { number: string | number } | null;
        latestBlock?: { number: string | number } | null;
      }>;
    }> = json.data?.indexingStatuses ?? [];

    return statuses.flatMap((s) =>
      (s.chains ?? []).map((chain) => {
        const network = chain.network ?? 'unknown';
        const chainHead = chain.chainHeadBlock ? Number(chain.chainHeadBlock.number) : undefined;
        const latest = chain.latestBlock ? Number(chain.latestBlock.number) : undefined;
        let blocksBehind: number | null = null;
        if (chainHead !== undefined && latest !== undefined) {
          const behind = Math.max(chainHead - latest, 0);
          blocksBehind = behind <= 10_000 ? behind : null; // cap stale/cross-chain noise
        }
        // Take the higher of the two: a node whose chain tracking has stalled can
        // report chainHeadBlock below a latestBlock it already indexed.
        const observed = Math.max(chainHead ?? 0, latest ?? 0);

        return {
          network,
          blocksBehind,
          synced: s.synced && s.health !== 'failed',
          failed: s.health === 'failed',
          chainHead: observed > 0 ? observed : null,
        };
      }),
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Cron handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();

  try {
    const indexers = await cacheGet<EnrichedIndexer[]>('lodestar:indexers-enriched');
    if (!indexers?.length) {
      return NextResponse.json({ ok: true, message: 'No indexers cached', durationMs: 0 });
    }

    // Top 50 reachable indexers with safe URLs
    const candidates = indexers
      .filter((ix) => ix.url && isSafeUrl(ix.url))
      .slice(0, 50);

    // Fan out — 10 concurrent to avoid hammering nodes
    const fetched = await runWithConcurrency(
      candidates,
      async (ix) => ({ addr: ix.id.toLowerCase(), deployments: await fetchIndexerDeployments(ix.url!) }),
      10,
    );

    // Per-chain accumulators
    const chainSampled: Record<string, Set<string>> = {};
    const chainBehind: Record<string, number[]> = {};
    /** Highest tip anyone reported for each chain this run. Feeds liveness. */
    const chainObservedHead: Record<string, number> = {};

    // Per-indexer dropped chains (addr → dropped chain names)
    const droppedChainsMap: Record<string, string[]> = {};

    for (const { addr, deployments } of fetched) {
      // Skip unreachable nodes — don't update their snapshot
      if (!deployments.length) continue;

      const activeChains = [
        ...new Set(deployments.map((d) => d.network).filter((n) => n && n !== 'unknown')),
      ];

      // Detect dropped chains vs previous snapshot
      const existing = await cacheGet<IndexerChainSnapshot>(`lodestar:indexer-chains:${addr}`);
      if (existing?.current?.length) {
        const dropped = existing.current.filter((c) => !activeChains.includes(c));
        if (dropped.length) droppedChainsMap[addr] = dropped;
      }

      // Persist updated snapshot (30-day TTL — chain history is long-lived)
      const snapshot: IndexerChainSnapshot = {
        current: activeChains,
        previous: existing?.current ?? null,
        capturedAt: Date.now(),
      };
      await cacheSet(`lodestar:indexer-chains:${addr}`, snapshot, 30 * 24 * 60 * 60);

      // Aggregate per-chain lag stats
      for (const dep of deployments) {
        if (!dep.network || dep.network === 'unknown') continue;

        // The chain tip belongs to the node, not to any one deployment, so a
        // FAILED subgraph still supplies a usable head observation. Collect it
        // before the failed-deployment skip below.
        if (dep.chainHead !== null) {
          chainObservedHead[dep.network] = Math.max(
            chainObservedHead[dep.network] ?? 0,
            dep.chainHead,
          );
        }

        if (dep.failed) continue;

        if (!chainSampled[dep.network]) {
          chainSampled[dep.network] = new Set();
          chainBehind[dep.network] = [];
        }
        chainSampled[dep.network].add(addr);

        if (!dep.synced && dep.blocksBehind !== null) {
          chainBehind[dep.network].push(dep.blocksBehind);
        }
      }
    }

    // Chain liveness — fold this run's tips into the persisted head history,
    // then classify. This is the one signal that does not collapse to "healthy"
    // when a chain stops: everything else is measured relative to a head that
    // has itself frozen. See lib/chain-liveness and graph-support#15.
    const now = Date.now();
    const priorHeads = (await cacheGet<ChainHeadRecords>('lodestar:chain-heads')) ?? {};
    const headRecords: ChainHeadRecords = { ...priorHeads };
    for (const [network, observed] of Object.entries(chainObservedHead)) {
      headRecords[network] = advanceChainHead(priorHeads[network], observed, now);
    }
    await cacheSet('lodestar:chain-heads', headRecords, HEAD_RECORD_TTL_SECONDS);

    // Build ChainLagData
    const chains: Record<string, ChainStats> = {};
    const notLive: string[] = [];
    for (const network of Object.keys(chainSampled)) {
      const behinds = chainBehind[network] ?? [];
      const verdict = classifyLiveness(headRecords[network], now);
      if (verdict.liveness === 'stalled' || verdict.liveness === 'halted') notLive.push(network);
      chains[network] = {
        medianBlocksBehind: median(behinds),
        sampledIndexers: chainSampled[network].size,
        laggingCount: behinds.length,
        liveness: verdict.liveness,
        observedHead: verdict.head,
        headStalledForMs: verdict.stalledForMs,
      };
    }

    if (notLive.length) {
      log.cron.warn(
        { step: 'refresh-chain-health', chains: notLive },
        'Chains whose head is not advancing',
      );
    }

    const lagData: ChainLagData = { chains, computedAt: now };
    await cacheSet('lodestar:chain-lag', lagData, 2 * 60 * 60);
    await cacheSet('lodestar:dropped-chains', droppedChainsMap, 2 * 60 * 60);

    const durationMs = Date.now() - start;
    log.cron.info(
      { step: 'refresh-chain-health', chains: Object.keys(chains).length, indexers: candidates.length, durationMs },
      'Chain health cron complete',
    );

    return NextResponse.json({
      ok: true,
      chains: Object.keys(chains).length,
      indexers: candidates.length,
      droppedCount: Object.keys(droppedChainsMap).length,
      durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - start;
    log.cron.error({ err: error, step: 'refresh-chain-health', durationMs }, 'Chain health cron failed');
    return NextResponse.json({ error: 'Chain health cron failed' }, { status: 500 });
  }
}
