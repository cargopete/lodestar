/**
 * Live USD spot price for a list of contracts via the Uniswap V3 subgraph
 * on The Graph Network.
 *
 * Why subgraph instead of Token API: the Token API's OHLC endpoint serves
 * cached hourly bars (the latest bar's `close` doesn't move within an hour
 * even when swaps happen). Uniswap V3's `Token.derivedETH` updates with
 * every indexed swap, and combined with `Bundle(1).ethPriceUSD` gives us a
 * truly live USD quote that mirrors what TradingView/CoinGecko show as
 * the "last price."
 */

import { recordDeficiency } from './deficiencies';

const GW_BASE = 'https://gateway-arbitrum.network.thegraph.com/api';
const UNISWAP_V3_MAINNET = '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV';

interface TokenNode {
  id: string;
  derivedETH: string | null;
}

interface SpotResponse {
  data?: {
    bundle: { ethPriceUSD: string } | null;
    tokens: TokenNode[];
  };
  errors?: Array<{ message: string }>;
}

/**
 * Fetch live USD prices for a batch of mainnet contracts. Returns a Map
 * keyed by lowercase contract address. Contracts with no V3 liquidity
 * (no `derivedETH`) are simply omitted from the result; callers should
 * fall back to the OHLC-derived price.
 */
export async function fetchSpotPrices(contracts: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const apiKey = process.env.GRAPH_API_KEY;
  if (!apiKey) {
    recordDeficiency('GRAPH_API_KEY_MISSING', 'spot-price fetch skipped: no GRAPH_API_KEY');
    return out;
  }
  if (contracts.length === 0) return out;

  const ids = contracts.map((c) => c.toLowerCase());
  const query = `
    query LiveSpot($ids: [ID!]!) {
      bundle(id: "1") { ethPriceUSD }
      tokens(where: { id_in: $ids }, first: 1000) {
        id
        derivedETH
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
    if (!res.ok) throw new Error(`uniswap v3 spot ${res.status}`);
    const body = (await res.json()) as SpotResponse;
    if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
    const ethUsd = Number(body.data?.bundle?.ethPriceUSD ?? '0');
    if (!isFinite(ethUsd) || ethUsd <= 0) return out;
    for (const t of body.data?.tokens ?? []) {
      const derived = Number(t.derivedETH ?? '0');
      if (!isFinite(derived) || derived <= 0) continue;
      out.set(t.id.toLowerCase(), derived * ethUsd);
    }
    return out;
  } catch (e) {
    recordDeficiency('SPOT_PRICE_QUERY_FAILED', `Uniswap V3 spot query failed: ${(e as Error).message}`);
    return out;
  }
}

export async function fetchSpotPrice(contract: string): Promise<number | null> {
  const map = await fetchSpotPrices([contract]);
  return map.get(contract.toLowerCase()) ?? null;
}
