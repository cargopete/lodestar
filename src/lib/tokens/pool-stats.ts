/**
 * Per-pool TVL + most-recent-day volume from the Uniswap V3 mainnet subgraph.
 *
 * Why a separate query: Token API's `/v1/evm/pools` returns the seed token's
 * pool universe but doesn't carry TVL or volume. The directory-level
 * `dex-volume.ts` aggregates per-token across venues; here we want per-pool
 * stats so the markets table can rank pools by liquidity / activity.
 *
 * Pools indexed by other protocols (Curve, CoW, Balancer) won't appear in
 * the V3 subgraph and silently return `null`; the UI tolerates that.
 */

import { recordDeficiency } from './deficiencies';

const GW_BASE = 'https://gateway-arbitrum.network.thegraph.com/api';
const UNISWAP_V3_MAINNET = '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV';
const UNISWAP_V2_MAINNET = 'GmSczqdCDZ3hJeYY9JphwsADn5rePUzUKm8EZcVuhRAm';

export interface PoolStats {
  tvlUsd: number | null;
  volume24hUsd: number | null;
  /** Pool fee in basis points (e.g. 3000 = 0.3%). Falls back to a per-protocol
   *  default when the source subgraph doesn't carry it. */
  feeBps: number | null;
  /**
   * Implied price of the seed token in USD as quoted by this specific pool.
   * Populated only when the counterparty is a stablecoin or WETH (otherwise
   * we don't have a USD reference for the counterparty leg). Used for
   * cross-pool spread reporting on the Markets card.
   */
  seedPriceUsd?: number | null;
}

interface PoolDayData {
  volumeUSD: string;
  date: number;
}

interface PoolNode {
  id: string;
  feeTier: string | null;
  totalValueLockedUSD: string | null;
  // V3's `token0Price` is "amount of token1 per unit of token0" (the price of
  // token0 quoted in token1). `token1Price` is the inverse. Decimal-adjusted.
  token0Price: string | null;
  token1Price: string | null;
  token0: { id: string; symbol: string };
  token1: { id: string; symbol: string };
  poolDayData: PoolDayData[];
}

interface Response {
  data?: { pools: PoolNode[] };
  errors?: Array<{ message: string }>;
}

interface V2Pair {
  id: string;
  reserveUSD: string | null;
}

interface V2DayData {
  pairAddress: string;
  date: number;
  dailyVolumeUSD: string | null;
}

interface V2Response {
  data?: { pairs: V2Pair[]; pairDayDatas: V2DayData[] };
  errors?: Array<{ message: string }>;
}

// Stable + ETH symbols recognised when deriving per-pool USD price. Anything
// outside this set is skipped — we don't carry per-token USD references for
// arbitrary counterparties at this layer.
const POOL_PRICE_STABLES = new Set(['USDC', 'USDT', 'DAI', 'FRAX', 'LUSD', 'GHO', 'USDe', 'USDS', 'crvUSD', 'PYUSD', 'TUSD']);
const POOL_PRICE_ETH = new Set(['WETH', 'ETH']);

async function fetchV3PoolStats(
  apiKey: string,
  ids: string[],
  seedContract: string,
  ethUsd: number | null
): Promise<Map<string, PoolStats>> {
  const out = new Map<string, PoolStats>();
  const query = `
    query PoolStats($ids: [ID!]!) {
      pools(where: { id_in: $ids }, first: 1000) {
        id
        feeTier
        totalValueLockedUSD
        token0Price
        token1Price
        token0 { id symbol }
        token1 { id symbol }
        poolDayData(first: 1, orderBy: date, orderDirection: desc) {
          date
          volumeUSD
        }
      }
    }
  `;
  try {
    const res = await fetch(`${GW_BASE}/${apiKey}/subgraphs/id/${UNISWAP_V3_MAINNET}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { ids } }),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`uniswap v3 pool-stats ${res.status}`);
    const body = (await res.json()) as Response;
    if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
    const seedLower = seedContract.toLowerCase();
    for (const p of body.data?.pools ?? []) {
      const tvl = Number(p.totalValueLockedUSD ?? '0');
      const vol = Number(p.poolDayData?.[0]?.volumeUSD ?? '0');
      const fee = Number(p.feeTier ?? '0');
      // Per-pool USD price for the seed token. V3 subgraph convention:
      //   token0Price = token0 per token1 (i.e. how much t0 you need to buy 1 t1)
      //   token1Price = token1 per token0
      // For our purposes we want "counterparty per seed" — so when the seed
      // is t0 (counterparty is t1), we want token1Price; when seed is t1,
      // we want token0Price. Then multiply by the counterparty's USD price
      // (1 for stables, ethUsd for WETH).
      let seedPriceUsd: number | null = null;
      const t0 = p.token0?.id?.toLowerCase();
      const t1 = p.token1?.id?.toLowerCase();
      const seedIsT0 = t0 === seedLower;
      const seedIsT1 = t1 === seedLower;
      if (seedIsT0 || seedIsT1) {
        const counterpartySym = (seedIsT0 ? p.token1?.symbol : p.token0?.symbol) ?? '';
        const counterpartyPerSeed = Number(
          seedIsT0 ? p.token1Price : p.token0Price
        );
        let cpUsdPerUnit: number | null = null;
        if (POOL_PRICE_STABLES.has(counterpartySym)) cpUsdPerUnit = 1;
        else if (POOL_PRICE_ETH.has(counterpartySym)) cpUsdPerUnit = ethUsd;
        if (
          cpUsdPerUnit != null &&
          Number.isFinite(counterpartyPerSeed) &&
          counterpartyPerSeed > 0
        ) {
          seedPriceUsd = counterpartyPerSeed * cpUsdPerUnit;
        }
      }
      out.set(p.id.toLowerCase(), {
        tvlUsd: Number.isFinite(tvl) && tvl > 0 ? tvl : null,
        volume24hUsd: Number.isFinite(vol) && vol > 0 ? vol : null,
        feeBps: Number.isFinite(fee) && fee > 0 ? fee : null,
        seedPriceUsd,
      });
    }
  } catch (e) {
    recordDeficiency('POOL_STATS_QUERY_FAILED', `v3 pool-stats query failed: ${(e as Error).message}`);
  }
  return out;
}

async function fetchV2PairStats(
  apiKey: string,
  ids: string[]
): Promise<Map<string, PoolStats>> {
  const out = new Map<string, PoolStats>();
  // V2's schema: TVL via `Pair.reserveUSD`, but daily volume lives in a
  // top-level `PairDayData` entity referenced by `pairAddress` (the schema
  // does NOT expose a `pairDayData` collection on `Pair` itself). We pull
  // both in a single GraphQL request and merge by pair address. Order by
  // date desc + first: 1 per pair gives the most recent UTC-day volume.
  const query = `
    query PairStats($ids: [ID!]!, $bytesIds: [Bytes!]!) {
      pairs(where: { id_in: $ids }, first: 1000) {
        id
        reserveUSD
      }
      pairDayDatas(
        where: { pairAddress_in: $bytesIds }
        first: 1000
        orderBy: date
        orderDirection: desc
      ) {
        pairAddress
        date
        dailyVolumeUSD
      }
    }
  `;
  try {
    const res = await fetch(`${GW_BASE}/${apiKey}/subgraphs/id/${UNISWAP_V2_MAINNET}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { ids, bytesIds: ids } }),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`uniswap v2 pool-stats ${res.status}`);
    const body = (await res.json()) as V2Response;
    if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
    // Index latest-day volume by pair address. `pairDayDatas` returns rows
    // for many pairs interleaved by date; first occurrence wins because the
    // query is sorted desc.
    const latestVolByPair = new Map<string, number>();
    for (const d of body.data?.pairDayDatas ?? []) {
      const addr = d.pairAddress.toLowerCase();
      if (latestVolByPair.has(addr)) continue;
      const v = Number(d.dailyVolumeUSD ?? '0');
      if (Number.isFinite(v) && v > 0) latestVolByPair.set(addr, v);
    }
    for (const p of body.data?.pairs ?? []) {
      const tvl = Number(p.reserveUSD ?? '0');
      const vol = latestVolByPair.get(p.id.toLowerCase()) ?? null;
      out.set(p.id.toLowerCase(), {
        tvlUsd: Number.isFinite(tvl) && tvl > 0 ? tvl : null,
        volume24hUsd: vol,
        // Uniswap V2 has a fixed 0.3% fee on every pair — no per-pool variance,
        // so we hardcode rather than ask the subgraph.
        feeBps: 3000,
      });
    }
  } catch (e) {
    recordDeficiency('POOL_STATS_QUERY_FAILED', `v2 pair-stats query failed: ${(e as Error).message}`);
  }
  return out;
}

export async function fetchPoolStats(
  poolIds: string[],
  seedContract: string,
  ethUsd: number | null
): Promise<Map<string, PoolStats>> {
  const out = new Map<string, PoolStats>();
  const apiKey = process.env.GRAPH_API_KEY;
  if (!apiKey || poolIds.length === 0) return out;

  // Fire both V2 and V3 lookups against the same id list. Each subgraph only
  // returns matches for pools it indexes; merging means a Uniswap V2 pair and
  // a V3 pool both populate. Other protocols (Bancor, Kyber Elastic, V1, V4)
  // remain null — surfaced in the UI as a dash. Kyber Elastic specifically
  // tends to *coincidentally* match V3 pool ids because it forks the V3
  // contract layout, which is why it shows TVL/volume in some rows already.
  const ids = poolIds.map((p) => p.toLowerCase());
  const [v3, v2] = await Promise.all([
    fetchV3PoolStats(apiKey, ids, seedContract, ethUsd),
    fetchV2PairStats(apiKey, ids),
  ]);
  for (const [k, v] of v3) out.set(k, v);
  for (const [k, v] of v2) out.set(k, v);
  return out;
}
