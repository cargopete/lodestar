/**
 * On-chain ERC-20 `totalSupply()` reader used to populate FDV.
 *
 * Why on-chain instead of Token API: Token API consistently returns
 * `total_supply: null` for our seed list (deficiency
 * TOKEN_API_NO_TOTAL_SUPPLY). The Uniswap V3 subgraph's `Token.totalSupply`
 * field doesn't track ERC-20 supply either — it carries a counter that
 * increments per pool/transaction. The contract is the only authoritative
 * source.
 *
 * Reuses the viem fallback client from `contract-detection.ts`, which
 * already has request batching configured for high-fan-out reads. One
 * cold pass = a couple of batched RPC round-trips for ~150 tokens.
 *
 * Process-scoped cache. Total supply changes only on mint/burn, which is
 * rare enough that a process lifetime cache is fine for v0.
 */

import { erc20Abi, parseUnits } from 'viem';
import { createPublicClient, fallback, http, type PublicClient } from 'viem';
import { arbitrum, base, mainnet, optimism, polygon } from 'viem/chains';
import type { TokenChain } from './types';

type ChainKey = TokenChain | 'arbitrum' | 'base' | 'polygon' | 'optimism';

const PUBLIC_RPCS: Record<ChainKey, string[]> = {
  mainnet: [
    'https://ethereum-rpc.publicnode.com',
    'https://eth.llamarpc.com',
    'https://1rpc.io/eth',
  ],
  arbitrum: ['https://arbitrum-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'],
  base: ['https://base-rpc.publicnode.com', 'https://mainnet.base.org'],
  polygon: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'],
  optimism: ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io'],
};

const RPC_ENV: Record<ChainKey, string> = {
  mainnet: 'MAINNET_RPC_URL',
  arbitrum: 'ARBITRUM_RPC_URL',
  base: 'BASE_RPC_URL',
  polygon: 'POLYGON_RPC_URL',
  optimism: 'OPTIMISM_RPC_URL',
};

const CHAIN_DEFS = { mainnet, arbitrum, base, polygon, optimism } as const;

function rpcsFor(chain: ChainKey): string[] {
  const override = process.env[RPC_ENV[chain]];
  return override ? [override, ...PUBLIC_RPCS[chain]] : PUBLIC_RPCS[chain];
}

const clients = new Map<ChainKey, PublicClient>();
function clientFor(chain: ChainKey): PublicClient {
  const existing = clients.get(chain);
  if (existing) return existing;
  const transports = rpcsFor(chain).map((url) =>
    http(url, { batch: { wait: 100, batchSize: 100 } })
  );
  const client = createPublicClient({
    chain: CHAIN_DEFS[chain],
    transport: fallback(transports, { rank: false, retryCount: 1 }),
  }) as PublicClient;
  clients.set(chain, client);
  return client;
}

// Cached as decimal-adjusted Number. Key: `${chain}:${address}`.
const cache = new Map<string, number | null>();

export async function fetchTotalSupply(
  chain: ChainKey,
  contract: string,
  decimals?: number
): Promise<number | null> {
  const key = `${chain}:${contract.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key)!;
  const client = clientFor(chain);
  try {
    // Fetch both totalSupply and decimals atomically. Tokens with non-18
    // decimals (USDC=6, WBTC=8, cbBTC=8, etc.) need the on-chain decimals
    // to scale correctly — the directory's parallel fan-out pre-empts the
    // metadata call so we can't rely on Token API for the decimals here.
    // viem coalesces these into the same JSON-RPC batch.
    const [raw, dec] = await Promise.all([
      client.readContract({
        address: contract as `0x${string}`,
        abi: erc20Abi,
        functionName: 'totalSupply',
      }),
      decimals != null
        ? Promise.resolve(decimals)
        : client.readContract({
            address: contract as `0x${string}`,
            abi: erc20Abi,
            functionName: 'decimals',
          }),
    ]);
    const divisor = parseUnits('1', Number(dec));
    const whole = raw / divisor;
    const frac = Number(raw % divisor) / Number(divisor);
    const total = Number(whole) + frac;
    if (!Number.isFinite(total) || total <= 0) {
      cache.set(key, null);
      return null;
    }
    cache.set(key, total);
    return total;
  } catch {
    // RPC failure: don't cache so the next request can retry.
    return null;
  }
}

export async function fetchTotalSupplies(
  items: Array<{ chain: ChainKey; contract: string; decimals?: number }>
): Promise<Map<string, number>> {
  const results = await Promise.all(
    items.map(async (it) => ({
      key: `${it.chain}:${it.contract.toLowerCase()}`,
      value: await fetchTotalSupply(it.chain, it.contract, it.decimals),
    }))
  );
  const out = new Map<string, number>();
  for (const r of results) if (r.value != null) out.set(r.key, r.value);
  return out;
}
