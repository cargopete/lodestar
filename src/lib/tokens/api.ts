/**
 * Low-level Token API client. Server-side only (the JWT must not be shipped
 * to the browser).
 *
 * Network choices: the API exposes 10 mainnets via /v1/networks. v0 only
 * targets `mainnet` (Ethereum). Add more chains by widening the `network`
 * union in types.ts and the seed map.
 */

import { recordDeficiency } from './deficiencies';

const BASE_URL = 'https://token-api.thegraph.com';

function authHeaders(): HeadersInit {
  const key = process.env.TOKEN_API_KEY;
  if (!key) throw new Error('TOKEN_API_KEY not set');
  return { 'X-Api-Key': key };
}

interface ApiEnvelope<T> {
  data: T[];
  statistics?: unknown;
  pagination?: unknown;
  request_time?: string;
  duration_ms?: number;
}

// Token API rate limit on our plan: 500 requests/min. The directory fan-out
// produces ~600 calls per cold load (154 tokens × ~4 calls), so we throttle
// here at the request layer rather than tuning per-call concurrency. Token
// bucket: refill one slot every 130ms (≈ 460 req/min, safely under the
// ceiling) with a burst capacity of 6 to soak short bursts without back-
// pressuring the caller.
const RATE_LIMIT_INTERVAL_MS = 130;
const RATE_LIMIT_BURST = 6;
let rateBucketTokens = RATE_LIMIT_BURST;
let rateLastRefillMs = Date.now();
async function acquireRateSlot(): Promise<void> {
  while (true) {
    const now = Date.now();
    const elapsed = now - rateLastRefillMs;
    if (elapsed > 0) {
      const refill = Math.floor(elapsed / RATE_LIMIT_INTERVAL_MS);
      if (refill > 0) {
        rateBucketTokens = Math.min(RATE_LIMIT_BURST, rateBucketTokens + refill);
        rateLastRefillMs += refill * RATE_LIMIT_INTERVAL_MS;
      }
    }
    if (rateBucketTokens > 0) {
      rateBucketTokens -= 1;
      return;
    }
    const wait = RATE_LIMIT_INTERVAL_MS - ((now - rateLastRefillMs) % RATE_LIMIT_INTERVAL_MS);
    await new Promise((r) => setTimeout(r, wait));
  }
}

/**
 * Shared low-level Token API GET. Exported so adjacent modules
 * (e.g. `hyperliquid.ts`) can hit `/v1/*` paths through the same auth +
 * rate-limit + 5xx/429 retry path used everywhere else. Path is the
 * leading-slash route (`/v1/...`); params become the query string.
 */
export async function tokenApiGet<T>(
  path: string,
  params: Record<string, string | number>
): Promise<ApiEnvelope<T>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const url = `${BASE_URL}${path}?${qs}`;
  await acquireRateSlot();
  // Retry on 5xx (transient under fan-out load) and 429 (rate-limited). The
  // 429 path waits longer because the API surfaces a per-minute ceiling and
  // immediate retries compound the problem; 800-1500ms gives the rate window
  // a chance to drain. Cap at 3 attempts so a sustained outage still surfaces
  // an error rather than stalling the request indefinitely.
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: authHeaders() });
    if (res.ok) return (await res.json()) as ApiEnvelope<T>;
    if (res.status >= 500 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
      continue;
    }
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 700));
      continue;
    }
    const body = await res.text().catch(() => '');
    lastErr = new Error(`Token API ${res.status} ${path}: ${body.slice(0, 200)}`);
    break;
  }
  throw lastErr ?? new Error(`Token API: unknown failure for ${path}`);
}

// --- Endpoint shapes ---

export interface ApiTokenMetadata {
  contract: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  circulating_supply: number | null;
  total_supply: number | null;
  holders: number | null;
  total_transfers: number | null;
  network: string;
  icon: { web3icon?: string } | null;
  last_update_timestamp?: number;
}

export interface ApiOhlcPoint {
  datetime: string;
  ticker: string;
  pool: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  transactions: number;
  network: string;
}

export interface ApiHolder {
  address: string;
  /** OpenAPI says number, API returns base-units string. See deficiency `TOKEN_API_HOLDERS_AMOUNT_STRING`. */
  amount: number | string;
  value: number | null;
  symbol: string | null;
  decimals: number | null;
}

export async function fetchTokenMetadata(
  network: string,
  contract: string
): Promise<ApiTokenMetadata | null> {
  const env = await tokenApiGet<ApiTokenMetadata>('/v1/evm/tokens', { network, contract });
  const t = env.data?.[0];
  if (!t) {
    recordDeficiency('TOKEN_API_TOKENS_EMPTY', `tokens endpoint returned 0 rows for ${network}/${contract}`);
    return null;
  }
  if (t.total_supply == null) {
    recordDeficiency(
      'TOKEN_API_NO_TOTAL_SUPPLY',
      `total_supply is null for ${t.symbol ?? contract} on ${network} (FDV cannot be computed)`
    );
  }
  if (t.icon == null || !t.icon.web3icon) {
    recordDeficiency(
      'TOKEN_API_MISSING_ICON',
      `icon missing for ${t.symbol ?? contract} on ${network}`
    );
  }
  return t;
}

export async function fetchPoolOhlc(
  network: string,
  pool: string,
  // Token API accepts '1h', '4h', and '1d' even though the OpenAPI doc only
  // lists '1h' / '1d'. We use '4h' for the directory sparkline.
  interval: '4h' | '1d' | '1w' = '1d',
  limit = 31,
  page = 1
): Promise<ApiOhlcPoint[]> {
  const params: Record<string, string | number> = { network, pool, interval, limit };
  if (page > 1) params.page = page;
  const env = await tokenApiGet<ApiOhlcPoint>('/v1/evm/pools/ohlc', params);
  // The API returns duplicate rows per datetime in some pools (observed on
  // CoW settlement and on shared Uniswap V3 pools). De-dupe by datetime,
  // keeping the row with the most transactions (likeliest the real bar).
  const byDate = new Map<string, ApiOhlcPoint>();
  for (const r of env.data ?? []) {
    const cur = byDate.get(r.datetime);
    if (!cur || (r.transactions ?? 0) > (cur.transactions ?? 0)) byDate.set(r.datetime, r);
  }
  if ((env.data?.length ?? 0) > byDate.size) {
    recordDeficiency(
      'TOKEN_API_OHLC_DUPES',
      `OHLC returned ${env.data?.length} rows but only ${byDate.size} distinct datetimes for pool ${pool}`
    );
  }
  return [...byDate.values()].sort((a, b) => a.datetime.localeCompare(b.datetime));
}

export async function fetchHolders(
  network: string,
  contract: string,
  limit = 10
): Promise<ApiHolder[]> {
  const env = await tokenApiGet<ApiHolder>('/v1/evm/holders', { network, contract, limit });
  return env.data ?? [];
}

export interface ApiPool {
  pool: string;
  factory: string;
  protocol: string;
  fee: number | null;
  input_token: { address: string; symbol: string | null; decimals: number | null };
  output_token: { address: string; symbol: string | null; decimals: number | null };
  network: string;
}

export async function fetchPoolsForToken(
  network: string,
  contract: string,
  limit = 25
): Promise<ApiPool[]> {
  const env = await tokenApiGet<ApiPool>('/v1/evm/pools', { network, input_token: contract, limit });
  return env.data ?? [];
}

export interface ApiSwap {
  datetime: string;
  timestamp: number;
  transaction_id: string;
  pool: string;
  protocol: string;
  input_token: { address: string; symbol: string | null; decimals: number | null };
  output_token: { address: string; symbol: string | null; decimals: number | null };
  input_amount: string | number;
  output_amount: string | number;
  input_value: number;
  output_value: number;
  price: number | null;
  user: string;
  sender: string;
  recipient: string;
}

export async function fetchSwapsForToken(
  network: string,
  contract: string,
  limit = 20
): Promise<ApiSwap[]> {
  // The API has no OR filter, so we issue two calls in parallel and merge.
  // Tracked: TOKEN_API_NO_OR_FILTER (recorded in fetcher when both succeed).
  const [asInput, asOutput] = await Promise.all([
    tokenApiGet<ApiSwap>('/v1/evm/swaps', { network, input_contract: contract, limit }),
    tokenApiGet<ApiSwap>('/v1/evm/swaps', { network, output_contract: contract, limit }),
  ]);
  const all = [...(asInput.data ?? []), ...(asOutput.data ?? [])];
  all.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  return all.slice(0, limit);
}
