/**
 * Wraps Uniswap's default token list (https://tokens.uniswap.org). The list
 * carries ~1,400 tokens with curated `logoURI` fields pointing at the best
 * available logo per token (TrustWallet, CoinGecko, CryptoLogos, etc.). This
 * is broader and better-curated than web3icons alone, so it's our primary
 * icon source. Cached in-process for the lifetime of the server.
 */

const UNISWAP_LIST_URL = 'https://tokens.uniswap.org/';

interface UniswapListEntry {
  chainId: number;
  address: string;
  symbol: string;
  logoURI?: string;
}

let cache: Map<string, string> | null = null;
let inflight: Promise<Map<string, string>> | null = null;

async function loadList(): Promise<Map<string, string>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(UNISWAP_LIST_URL, {
        headers: { 'User-Agent': 'Lodestar/1.0' },
        // Hint Next.js to revalidate every 24h.
        next: { revalidate: 86_400 },
      });
      if (!res.ok) throw new Error(`tokens.uniswap.org ${res.status}`);
      const json = await res.json();
      const tokens: UniswapListEntry[] = json?.tokens ?? [];
      const map = new Map<string, string>();
      for (const t of tokens) {
        if (t.logoURI && t.address) {
          // Key by `<chainId>:<lowercase contract>` so multi-chain entries
          // for the same project don't collide.
          map.set(`${t.chainId}:${t.address.toLowerCase()}`, t.logoURI);
        }
      }
      cache = map;
      return map;
    } catch (e) {
      console.warn('[uniswap-token-list] failed:', (e as Error).message);
      cache = new Map();
      return cache;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const CHAIN_ID: Record<string, number> = {
  mainnet: 1,
  arbitrum: 42161,
  base: 8453,
  polygon: 137,
  optimism: 10,
};

/**
 * Look up a token's logo URI from Uniswap's default list.
 * Returns null if the token isn't in the list or the list fetch failed.
 */
export async function getUniswapLogoUri(
  chain: string,
  contract: string
): Promise<string | null> {
  const cid = CHAIN_ID[chain] ?? 1;
  const map = await loadList();
  return map.get(`${cid}:${contract.toLowerCase()}`) ?? null;
}
