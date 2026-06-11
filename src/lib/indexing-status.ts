/**
 * Indexing status types and helpers.
 * Queries individual indexer /status endpoints (graph-node status API proxy)
 * to aggregate sync state, health, and error data for a given deployment.
 *
 * Also hosts the live SERVING probe (RFC-006 D1): /status tells us whether an
 * indexer is *indexing*; the serving probe tells us whether the paid query path
 * actually answers right now — the question the iExec page got wrong.
 */

import { isSafeUrlResolved } from './ssrf';
import type { ServabilityVerdict } from './servability';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of a single receipt-less query-path probe:
 *  - alive_paid  — serving stack is up (answered, or correctly demanded a TAP receipt)
 *  - broken      — refused / timeout / 5xx / HTML / bare 4xx: not serving
 *  - unreachable — could not safely attempt (no URL / SSRF-blocked / DNS fail)
 */
export type ServeProbe = 'alive_paid' | 'broken' | 'unreachable';

export interface IndexerStatusResult {
  indexerId: string;
  indexerName: string | null;
  url: string;
  allocatedTokens: string;
  status: 'synced' | 'syncing' | 'failed' | 'unreachable';
  /** single-probe serving classification (RFC-006 D1); persistence is applied downstream */
  serveProbe?: ServeProbe;
  /** convenience: serveProbe === 'alive_paid' */
  servable?: boolean;
  health?: 'healthy' | 'unhealthy' | 'failed';
  synced?: boolean;
  chainHeadBlock?: number;
  latestBlock?: number;
  network?: string;
  entityCount?: string;
  fatalError?: {
    message: string;
    handler?: string | null;
    block?: { number: number; hash?: string } | null;
    deterministic?: boolean;
  };
  nonFatalErrors?: string[];
  nonFatalErrorCount?: number;
  syncProgress?: number; // 0-100
  blocksBehind?: number;
}

export interface DeploymentIndexingStatus {
  deploymentId: string;
  ipfsHash: string;
  displayName: string | null;
  signalledTokens: string;
  stakedTokens: string;
  indexers: IndexerStatusResult[];
  totalIndexers: number;
  totalAllocations: number;
  syncedCount: number;
  healthyCount: number;
  unhealthyCount: number;
  failedCount: number;
  unreachableCount: number;
  /** RFC-006 D2 — live serving verdict over the allocated set (null if not probed) */
  servability?: ServabilityVerdict | null;
}

// ---------------------------------------------------------------------------
// Graph-node status API query
// ---------------------------------------------------------------------------

function statusQuery(deploymentHash: string) {
  return `{
  indexingStatuses(subgraphs: ["${deploymentHash}"]) {
    subgraph
    synced
    health
    fatalError {
      message
      handler
      block {
        number
        hash
      }
      deterministic
    }
    nonFatalErrors {
      message
    }
    chains {
      ... on EthereumIndexingStatus {
        network
        chainHeadBlock {
          number
        }
        latestBlock {
          number
        }
      }
    }
    entityCount
  }
}`;
}

interface StatusAPIResponse {
  data?: {
    indexingStatuses?: Array<{
      subgraph: string;
      synced: boolean;
      health: 'healthy' | 'unhealthy' | 'failed';
      fatalError?: {
        message: string;
        handler?: string | null;
        block?: { number: string | number; hash?: string } | null;
        deterministic?: boolean;
      } | null;
      nonFatalErrors?: Array<{ message: string }>;
      chains?: Array<{
        network?: string;
        chainHeadBlock?: { number: string | number } | null;
        latestBlock?: { number: string | number } | null;
      }>;
      entityCount?: string;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Query a single indexer's /status endpoint
// ---------------------------------------------------------------------------

export async function queryIndexerStatus(
  indexerUrl: string,
  deploymentHash: string,
  timeoutMs = 3000,
): Promise<StatusAPIResponse | null> {
  const baseUrl = indexerUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/status`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: statusQuery(deploymentHash) }),
      signal: controller.signal,
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Build a normalised status result from the raw response
// ---------------------------------------------------------------------------

export function buildIndexerStatus(
  indexerId: string,
  indexerName: string | null,
  url: string,
  allocatedTokens: string,
  raw: StatusAPIResponse | null,
): IndexerStatusResult {
  if (!raw?.data?.indexingStatuses?.length) {
    return { indexerId, indexerName, url, allocatedTokens, status: 'unreachable' };
  }

  const s = raw.data.indexingStatuses[0];
  const chain = s.chains?.[0];
  const chainHead = chain?.chainHeadBlock ? Number(chain.chainHeadBlock.number) : undefined;
  const latest = chain?.latestBlock ? Number(chain.latestBlock.number) : undefined;

  let syncProgress: number | undefined;
  let blocksBehind: number | undefined;

  if (chainHead && latest) {
    syncProgress = chainHead > 0 ? Math.min((latest / chainHead) * 100, 100) : 0;
    blocksBehind = Math.max(chainHead - latest, 0);
  }

  // The graph-node `synced` flag means "has caught up at some point" — not
  // "is currently at the chain head."  An indexer can report synced=true while
  // being thousands of blocks behind if it fell behind after initially syncing.
  // We use blocksBehind as the ground truth: <= 50 blocks is effectively synced.
  const effectivelySynced = blocksBehind !== undefined ? blocksBehind <= 50 : !!s.synced;

  let status: IndexerStatusResult['status'] = 'syncing';
  if (s.health === 'failed' || s.fatalError) {
    status = 'failed';
  } else if (effectivelySynced) {
    status = 'synced';
  }

  return {
    indexerId,
    indexerName,
    url,
    allocatedTokens,
    status,
    health: s.health,
    synced: s.synced,
    chainHeadBlock: chainHead,
    latestBlock: latest,
    network: chain?.network ?? undefined,
    entityCount: s.entityCount,
    fatalError: s.fatalError
      ? {
          message: s.fatalError.message,
          handler: s.fatalError.handler,
          block: s.fatalError.block
            ? { number: Number(s.fatalError.block.number), hash: s.fatalError.block.hash }
            : null,
          deterministic: s.fatalError.deterministic,
        }
      : undefined,
    nonFatalErrors: s.nonFatalErrors?.length
      ? s.nonFatalErrors.slice(-5).map((e) => e.message)
      : undefined,
    nonFatalErrorCount: s.nonFatalErrors?.length ?? 0,
    syncProgress,
    blocksBehind,
  };
}

// ---------------------------------------------------------------------------
// Live serving probe (RFC-006 D1)
// ---------------------------------------------------------------------------

// The shape a healthy-but-unpaid indexer-service returns when it wants a TAP
// receipt. indexer-service-rs versions phrase this differently, so the matcher
// is deliberately broad — real-indexer fixtures should tighten it during the
// D5 cron rollout (calibrate against a known-good indexer AND the leech).
const PAYMENT_SHAPE =
  /receipt|payment\s*(is\s*)?required|requires?\s*payment|x-payment|\btap\b|paid\s*quer|free\s*quer|insufficient|unpaid|402/i;

/**
 * Pure classifier for a serving-path response. Separated from IO so the decision
 * logic is exhaustively unit-testable without network or DNS. Never returns
 * 'unreachable' — that's decided before a response exists.
 */
export function classifyServeResponse(
  status: number,
  contentType: string,
  body: string,
): Exclude<ServeProbe, 'unreachable'> {
  // 402 Payment Required is the canonical "serving stack up, needs a receipt".
  if (status === 402) return 'alive_paid';

  const looksHtml = /^\s*</.test(body) || contentType.toLowerCase().includes('text/html');

  if (status >= 200 && status < 300) {
    // A JSON body (data OR GraphQL errors) means the query stack answered. HTML
    // on a 200 is a proxy / landing page, not the serving path.
    if (looksHtml) return 'broken';
    try {
      JSON.parse(body);
      return 'alive_paid';
    } catch {
      return 'broken';
    }
  }

  // Non-2xx: only the specific payment/receipt 4xx counts as alive. A bare 400,
  // a 404, a 5xx, or an HTML error page is a broken serving path.
  if (status >= 400 && status < 500 && !looksHtml && PAYMENT_SHAPE.test(body)) {
    return 'alive_paid';
  }
  return 'broken';
}

/**
 * Probe an indexer's paid query path for a deployment, without a receipt.
 * SSRF-guarded (resolves DNS, rejects private targets — fail closed).
 * Returns a single-probe classification; the "non-serving" verdict requires
 * persistence (N consecutive broken), applied by the caller (RFC-006 D2/D5).
 */
export async function probeServing(
  indexerUrl: string,
  ipfsHash: string,
  timeoutMs = 4000,
): Promise<ServeProbe> {
  const base = indexerUrl?.replace(/\/+$/, '');
  if (!base || !(await isSafeUrlResolved(base))) return 'unreachable';

  const url = `${base}/subgraphs/id/${ipfsHash}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ _meta { block { number } } }' }),
      signal: controller.signal,
    });
    const body = await res.text();
    return classifyServeResponse(res.status, res.headers.get('content-type') ?? '', body);
  } catch {
    // Refused / reset / timeout — DNS failures were already caught by the guard.
    return 'broken';
  } finally {
    clearTimeout(timer);
  }
}

/** Fold a probe into an existing status result. */
export function withServeProbe(result: IndexerStatusResult, probe: ServeProbe): IndexerStatusResult {
  return { ...result, serveProbe: probe, servable: probe === 'alive_paid' };
}
