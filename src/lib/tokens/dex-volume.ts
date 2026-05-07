/**
 * DEX volume aggregation across native Uniswap V2 + V3 deployments on
 * The Graph Network (Arbitrum gateway). One batched query per subgraph
 * for all seeds at once, so cost is O(subgraphs) not O(seeds).
 *
 * Coverage today:
 *   - Uniswap V3 mainnet, V2 mainnet (subgraph IDs)
 *   - Uniswap V3 Arbitrum, Base, Polygon (deployment IPFS hashes)
 *
 * Why subgraph queries instead of Token API: Token API has no per-token
 * aggregate volume, only per-pool OHLC. Tracked as deficiency
 * `TOKEN_API_NO_TOKEN_LEVEL_VOLUME`.
 *
 * Schemas: native Uniswap V3 exposes `Token.volumeUSD` + `tokenDayData`.
 * Uniswap V2 exposes `tradeVolumeUSD` + `tokenDayData.dailyVolumeUSD`.
 * Sushi/Curve/Balancer all use the Messari standardized schema which has
 * no per-token day volume; aggregating volume there requires walking pool
 * entities and is deferred to a follow-on iteration.
 */

import type { TokenSeed } from './types';

const GW_BASE = 'https://gateway-arbitrum.network.thegraph.com/api';

type Chain = 'mainnet' | 'arbitrum' | 'base' | 'polygon' | 'optimism';

interface SubgraphSpec {
  /** Display label for the breakdown popover. */
  venue: string;
  chain: Chain;
  /** Either `subgraphs/id/<id>` or `deployments/id/<ipfsHash>`. */
  endpoint: { kind: 'subgraph'; id: string } | { kind: 'deployment'; hash: string };
  /** Returns a `tokens(where: { id_in })` query for the subgraph's schema. */
  buildQuery: (idsLowercase: string[]) => string;
  /** Picks the latest day's volume in USD from a token row. */
  extractDayVolume: (token: SubgraphTokenRow) => number;
}

interface SubgraphTokenRow {
  id?: string;
  tokenDayData?: Array<{ volumeUSD?: string | number; dailyVolumeUSD?: string | number }>;
}

const v3Schema = {
  buildQuery: (ids: string[]) => `{
    tokens(where: { id_in: ${JSON.stringify(ids)} }) {
      id
      tokenDayData(first: 1, orderBy: date, orderDirection: desc) { volumeUSD }
    }
  }`,
  extractDayVolume: (t: SubgraphTokenRow) => Number(t?.tokenDayData?.[0]?.volumeUSD ?? 0),
};

const v2Schema = {
  buildQuery: (ids: string[]) => `{
    tokens(where: { id_in: ${JSON.stringify(ids)} }) {
      id
      tokenDayData(first: 1, orderBy: date, orderDirection: desc) { dailyVolumeUSD }
    }
  }`,
  extractDayVolume: (t: SubgraphTokenRow) => Number(t?.tokenDayData?.[0]?.dailyVolumeUSD ?? 0),
};

const SPECS: SubgraphSpec[] = [
  // Mainnet — subgraph IDs (canonical Uniswap deployments).
  {
    venue: 'Uniswap V3',
    chain: 'mainnet',
    endpoint: { kind: 'subgraph', id: '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV' },
    ...v3Schema,
  },
  {
    venue: 'Uniswap V2',
    chain: 'mainnet',
    endpoint: { kind: 'subgraph', id: 'GmSczqdCDZ3hJeYY9JphwsADn5rePUzUKm8EZcVuhRAm' },
    ...v2Schema,
  },
  // L2 / sidechain Uniswap V3 — deployment IPFS hashes (native schema variants
  // discovered on the Graph Network; verified to expose `tokenDayData`).
  {
    venue: 'Uniswap V3',
    chain: 'arbitrum',
    endpoint: { kind: 'deployment', hash: 'QmZ5uwhnwsJXAQGYEF8qKPQ85iVhYAcVZcZAPfrF7ZNb9z' },
    ...v3Schema,
  },
  {
    venue: 'Uniswap V3',
    chain: 'base',
    endpoint: { kind: 'deployment', hash: 'Qmb4VUcAY9LsVgeCuCCMs7X1XrkbRcaiuAbSK8SqhmsAfP' },
    ...v3Schema,
  },
  {
    venue: 'Uniswap V3',
    chain: 'polygon',
    endpoint: { kind: 'deployment', hash: 'QmdAaDAUDCypVB85eFUkQMkS5DE1HV4s7WJb6iSiygNvAw' },
    ...v3Schema,
  },
];

export interface DexVolumeBreakdown {
  /** Mainnet contract address (the seed's primary identifier). */
  contract: string;
  /** Sum of latest-day volumes across every queried subgraph, in USD. */
  totalUsd: number;
  /** Keyed `"<venue> · <Chain>"` → USD. Used by the index tooltip. */
  byVenue: Record<string, number>;
}

function gatewayUrl(spec: SubgraphSpec, apiKey: string): string {
  if (spec.endpoint.kind === 'subgraph') {
    return `${GW_BASE}/${apiKey}/subgraphs/id/${spec.endpoint.id}`;
  }
  return `${GW_BASE}/${apiKey}/deployments/id/${spec.endpoint.hash}`;
}

function chainLabel(chain: Chain): string {
  switch (chain) {
    case 'mainnet': return 'Ethereum';
    case 'arbitrum': return 'Arbitrum';
    case 'base': return 'Base';
    case 'polygon': return 'Polygon';
    case 'optimism': return 'Optimism';
  }
}

function contractForChain(seed: TokenSeed, chain: Chain): string | null {
  if (chain === 'mainnet') return seed.contract.toLowerCase();
  return seed.altContracts?.[chain]?.toLowerCase() ?? null;
}

async function querySubgraph(
  spec: SubgraphSpec,
  contractsLower: string[],
  apiKey: string
): Promise<Map<string, number>> {
  if (contractsLower.length === 0) return new Map();
  const res = await fetch(gatewayUrl(spec, apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: spec.buildQuery(contractsLower) }),
  });
  if (!res.ok) {
    throw new Error(`${spec.venue} (${spec.chain}) ${res.status}`);
  }
  const json: { data?: { tokens?: SubgraphTokenRow[] }; errors?: unknown } = await res.json();
  if (json.errors) throw new Error(`${spec.venue} (${spec.chain}): ${JSON.stringify(json.errors).slice(0, 200)}`);
  const rows = json.data?.tokens ?? [];
  const out = new Map<string, number>();
  for (const t of rows) out.set(String(t.id).toLowerCase(), spec.extractDayVolume(t));
  return out;
}

interface CurvePool {
  totalValueLockedUSD?: string | number;
  inputTokens?: Array<{ id: string }>;
  dailySnapshots?: Array<{ dailyVolumeUSD?: string | number }>;
}

/**
 * Curve Finance Ethereum (Messari schema). Per-token volume isn't available
 * directly; we walk top pools by cumulative volume, take each pool's latest
 * `dailySnapshots[0].dailyVolumeUSD`, and attribute that volume equally across
 * the pool's `inputTokens`. Approximation, but for a Curve 3pool (USDC/USDT/
 * DAI) splitting $X equally is roughly right since prices are similar.
 */
async function fetchCurveVolume(
  seeds: TokenSeed[],
  apiKey: string
): Promise<Map<string, number>> {
  const url = `${GW_BASE}/${apiKey}/deployments/id/QmRpHzsesvv7VTrKjEuutiZ7xEfDfd6jH4mgSeDDbUDVRN`;
  const seedSet = new Set(seeds.filter((s) => s.chain === 'mainnet').map((s) => s.contract.toLowerCase()));
  // Pull top pools by cumulative volume, but Messari Curve mainnet contains
  // a lot of junk: zero-TVL test pools with absurd `dailyVolumeUSD` from
  // flash-loan / wash trading (e.g. pxETH/vETH at $9 quadrillion daily). We
  // pull a wider slice and filter client-side: real pools have non-trivial
  // TVL, and no real pool turns over more than ~10× its TVL in a day.
  const query = `{
    liquidityPools(first: 250, orderBy: cumulativeVolumeUSD, orderDirection: desc) {
      totalValueLockedUSD
      inputTokens { id }
      dailySnapshots(first: 1, orderBy: timestamp, orderDirection: desc) {
        dailyVolumeUSD
      }
    }
  }`;
  const MIN_TVL_USD = 10_000;
  const MAX_DAILY_TURNOVER = 10; // dailyVol / TVL ceiling
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`Curve subgraph ${res.status}`);
    const json: { data?: { liquidityPools?: CurvePool[] }; errors?: unknown } = await res.json();
    if (json.errors) throw new Error(`Curve: ${JSON.stringify(json.errors).slice(0, 200)}`);
    const pools = json.data?.liquidityPools ?? [];
    const out = new Map<string, number>();
    let dropped = 0;
    for (const p of pools) {
      const tvlUsd = Number(p?.totalValueLockedUSD ?? 0);
      const dailyUsd = Number(p?.dailySnapshots?.[0]?.dailyVolumeUSD ?? 0);
      if (dailyUsd <= 0) continue;
      // Filter junk/wash pools: require real TVL and a sane daily turnover.
      if (tvlUsd < MIN_TVL_USD || dailyUsd / tvlUsd > MAX_DAILY_TURNOVER) {
        dropped++;
        continue;
      }
      const inputs: string[] = (p.inputTokens ?? []).map((t) => String(t.id).toLowerCase());
      const matchingSeeds = inputs.filter((id) => seedSet.has(id));
      if (matchingSeeds.length === 0) continue;
      const perLeg = dailyUsd / Math.max(inputs.length, 1);
      for (const id of matchingSeeds) {
        out.set(id, (out.get(id) ?? 0) + perLeg);
      }
    }
    if (dropped > 0) {
      console.warn(`[dex-volume] Curve filtered ${dropped}/${pools.length} pools (low TVL or absurd turnover)`);
    }
    return out;
  } catch (e) {
    console.warn('[dex-volume] Curve failed:', (e as Error).message);
    return new Map();
  }
}

export async function fetchDexVolumes(
  seeds: TokenSeed[]
): Promise<Map<string, DexVolumeBreakdown>> {
  const apiKey = process.env.GRAPH_API_KEY;
  if (!apiKey) return new Map();

  // For each spec, build the chain-specific contract list (only seeds that
  // have an address on that chain) and a reverse map back to the primary
  // mainnet contract for assembling the result.
  const perSpecResults = await Promise.all(
    SPECS.map(async (spec) => {
      const altToPrimary = new Map<string, string>();
      const queryIds: string[] = [];
      for (const s of seeds) {
        const c = contractForChain(s, spec.chain);
        if (c) {
          altToPrimary.set(c, s.contract.toLowerCase());
          queryIds.push(c);
        }
      }
      if (queryIds.length === 0) return { spec, byPrimary: new Map<string, number>() };
      try {
        const byAlt = await querySubgraph(spec, queryIds, apiKey);
        const byPrimary = new Map<string, number>();
        for (const [alt, vol] of byAlt) {
          const primary = altToPrimary.get(alt);
          if (primary) byPrimary.set(primary, vol);
        }
        return { spec, byPrimary };
      } catch (e) {
        console.warn(`[dex-volume] ${spec.venue} (${spec.chain}) failed:`, (e as Error).message);
        return { spec, byPrimary: new Map<string, number>() };
      }
    })
  );

  // Pool-walk venue (Curve mainnet): ran in parallel with the V2/V3 calls.
  const curveVolByPrimary = await fetchCurveVolume(seeds, apiKey);

  const out = new Map<string, DexVolumeBreakdown>();
  for (const seed of seeds) {
    const primary = seed.contract.toLowerCase();
    const byVenue: Record<string, number> = {};
    let total = 0;
    for (const { spec, byPrimary } of perSpecResults) {
      const v = byPrimary.get(primary) ?? 0;
      if (v > 0) {
        const key = `${spec.venue} · ${chainLabel(spec.chain)}`;
        byVenue[key] = (byVenue[key] ?? 0) + v;
        total += v;
      }
    }
    const curveVol = curveVolByPrimary.get(primary) ?? 0;
    if (curveVol > 0) {
      byVenue['Curve · Ethereum'] = curveVol;
      total += curveVol;
    }
    out.set(primary, { contract: primary, totalUsd: total, byVenue });
  }
  return out;
}
