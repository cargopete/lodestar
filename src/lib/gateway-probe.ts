/**
 * Gateway serving probe.
 *
 * Fires a live query at a deployment THROUGH the decentralised gateway — the
 * exact path a real consumer's API key takes — and reports whether the gateway
 * could serve it, and if not, WHY, per indexer.
 *
 * This is the layer neither /status nor the QoS oracle covers:
 *   - /status  answers "is the indexer indexing?"          (graph-node view)
 *   - QoS      answers "did past queries succeed?"          (oracle, historical)
 *   - this     answers "can the gateway serve RIGHT NOW,    (consumer view, live)
 *              and if not, what did each indexer say?"
 *
 * The gateway rejects indexers with a machine-readable string, e.g.:
 *   bad indexers: {0xabc…: BadResponse(no attestation: indexing_error),
 *                  0xdef…: Unavailable(too far behind)}
 * We parse that into structured per-indexer verdicts.
 */

const GATEWAY_BASE = 'https://gateway-arbitrum.network.thegraph.com';

function gatewayUrl(hash: string): string | null {
  const key = process.env.GRAPH_API_KEY;
  if (!key) return null;
  // Qm… / bafy… are deployment (IPFS) hashes; anything else is treated as a
  // subgraph (GNS/NFT) id. The gateway serves both, on different paths.
  const isDeployment = hash.startsWith('Qm') || hash.startsWith('bafy');
  const path = isDeployment ? `deployments/id/${hash}` : `subgraphs/id/${hash}`;
  return `${GATEWAY_BASE}/api/${key}/${path}`;
}

export function hasGatewayAccess(): boolean {
  return !!process.env.GRAPH_API_KEY;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GatewayVerdict =
  | 'served' // gateway returned attested data
  | 'bad-indexers' // every tried indexer was rejected
  | 'no-indexers' // no indexers available to try
  | 'not-found' // deployment/subgraph unknown to the gateway
  | 'error'; // some other gateway error

/** Normalised reason bucket, for colour + copy. */
export type BadIndexerCategory = 'stale' | 'errored' | 'unavailable' | 'timeout' | 'other';

export interface BadIndexer {
  /** lower-cased 0x address */
  indexer: string;
  /** gateway verdict kind, e.g. BadResponse, Unavailable, Timeout */
  kind: string;
  /** text inside the parentheses, e.g. "too far behind" */
  detail: string;
  category: BadIndexerCategory;
}

export interface GatewayProbeResult {
  /** the hash we probed (deployment ipfs or subgraph id) */
  hash: string;
  verdict: GatewayVerdict;
  /** block number from _meta when served */
  servedBlock: number | null;
  badIndexers: BadIndexer[];
  /** raw gateway message when not served */
  message: string | null;
  probedAt: string;
}

// ---------------------------------------------------------------------------
// Pure parsing / classification
// ---------------------------------------------------------------------------

/** Bucket a rejection into a category from its detail text, falling back to kind. */
export function classifyBadIndexer(kind: string, detail: string): BadIndexerCategory {
  const d = detail.toLowerCase();
  if (d.includes('too far behind') || d.includes('behind')) return 'stale';
  if (d.includes('attestation') || d.includes('indexing_error') || d.includes('indexing error')) {
    return 'errored';
  }
  if (d.includes('timeout') || d.includes('timed out')) return 'timeout';

  switch (kind.toLowerCase()) {
    case 'unavailable':
      return 'unavailable';
    case 'timeout':
      return 'timeout';
    case 'badresponse':
      return 'errored';
    default:
      return 'other';
  }
}

/** Short human label for a bad-indexer verdict. */
export function badIndexerLabel(b: BadIndexer): string {
  switch (b.category) {
    case 'stale':
      return 'Too far behind';
    case 'errored':
      return 'Not attesting (indexing error)';
    case 'unavailable':
      return 'Unavailable';
    case 'timeout':
      return 'Timed out';
    default:
      return b.kind;
  }
}

/**
 * Parse the gateway's `bad indexers: {addr: Kind(detail), …}` message into
 * structured verdicts. Tolerant of spacing and of entries with no parentheses.
 */
export function parseBadIndexers(message: string): BadIndexer[] {
  const out: BadIndexer[] = [];
  // addr : Kind ( detail )   — detail is everything up to the first close paren
  const withParen = /0x([0-9a-fA-F]{40})\s*:\s*(\w+)\(([^)]*)\)/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = withParen.exec(message)) !== null) {
    const indexer = `0x${m[1].toLowerCase()}`;
    const kind = m[2];
    const detail = m[3].trim();
    seen.add(indexer);
    out.push({ indexer, kind, detail, category: classifyBadIndexer(kind, detail) });
  }
  // Bare entries with no parenthesised detail, e.g. `0xabc…: Timeout`
  const bare = /0x([0-9a-fA-F]{40})\s*:\s*(\w+)(?!\s*\()/g;
  while ((m = bare.exec(message)) !== null) {
    const indexer = `0x${m[1].toLowerCase()}`;
    if (seen.has(indexer)) continue;
    const kind = m[2];
    out.push({ indexer, kind, detail: '', category: classifyBadIndexer(kind, '') });
  }
  return out;
}

interface GatewayBody {
  data?: { _meta?: { block?: { number?: number | string } | null } | null } | null;
  errors?: Array<{ message?: string }>;
}

/**
 * Pure classifier: turn an HTTP status + parsed JSON body into a verdict.
 * Separated from IO so it's exhaustively unit-testable without a network.
 */
export function interpretGatewayResponse(
  hash: string,
  status: number,
  body: GatewayBody | null,
  probedAt: string,
): GatewayProbeResult {
  const base = { hash, servedBlock: null, badIndexers: [] as BadIndexer[], message: null as string | null, probedAt };

  const firstError = body?.errors?.[0]?.message ?? null;

  // A data payload with no errors is a served, attested response.
  if (body?.data != null && !firstError) {
    const rawBlock = body.data._meta?.block?.number;
    const servedBlock = rawBlock != null ? Number(rawBlock) : null;
    return { ...base, verdict: 'served', servedBlock };
  }

  if (firstError) {
    const msg = firstError;
    const lower = msg.toLowerCase();
    if (lower.startsWith('bad indexers')) {
      return { ...base, verdict: 'bad-indexers', badIndexers: parseBadIndexers(msg), message: msg };
    }
    if (lower.includes('not found')) {
      return { ...base, verdict: 'not-found', message: msg };
    }
    if (lower.includes('no indexers') || lower.includes('no allocations')) {
      return { ...base, verdict: 'no-indexers', message: msg };
    }
    return { ...base, verdict: 'error', message: msg };
  }

  // No data, no error we understand — surface the HTTP status.
  return { ...base, verdict: 'error', message: `Gateway returned HTTP ${status}` };
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

/**
 * Probe the gateway for a deployment/subgraph. Sends the smallest possible
 * attestable query (`_meta`) so cost is negligible. Never throws — network
 * failures collapse to an 'error' verdict.
 */
export async function probeGateway(
  hash: string,
  probedAt: string,
  timeoutMs = 15000,
): Promise<GatewayProbeResult> {
  const url = gatewayUrl(hash);
  const empty: GatewayProbeResult = {
    hash,
    verdict: 'error',
    servedBlock: null,
    badIndexers: [],
    message: 'No API key configured',
    probedAt,
  };
  if (!url) return empty;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ _meta { block { number } } }' }),
      signal: controller.signal,
    });
    let body: GatewayBody | null = null;
    try {
      body = (await res.json()) as GatewayBody;
    } catch {
      body = null;
    }
    return interpretGatewayResponse(hash, res.status, body, probedAt);
  } catch {
    return { ...empty, message: 'Gateway unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
