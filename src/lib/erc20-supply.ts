/**
 * On-chain ERC-20 `totalSupply()` and `balanceOf()` readers.
 *
 * The contract is the only authoritative source for circulating supply:
 * indexed sources either omit it or, in the case of the Uniswap V3
 * subgraph's `Token.totalSupply`, carry a per-pool transaction counter
 * that has nothing to do with ERC-20 supply.
 *
 * Builds its own viem client per chain with a public-RPC fallback list and
 * request batching, so a fan-out of reads costs a couple of batched
 * round-trips rather than one call each.
 *
 * Total supply is cached for the process lifetime — it only moves on
 * mint/burn. Balances are not cached; they move constantly.
 */

import { erc20Abi, parseUnits } from 'viem';
import { createPublicClient, fallback, http, type PublicClient } from 'viem';
import { arbitrum, base, mainnet, optimism, polygon } from 'viem/chains';

export type ChainKey = 'mainnet' | 'arbitrum' | 'base' | 'polygon' | 'optimism';

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
    // to scale correctly, and callers that don't already know them get
    // them read here. viem coalesces both into the same JSON-RPC batch.
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

/**
 * On-chain ERC-20 `balanceOf(holder)` reader, decimal-adjusted to whole tokens.
 * Reuses the same batched/fallback client as {@link fetchTotalSupply}. Used to
 * read the L1 BridgeEscrow's GRT balance for de-double-counting global supply.
 * Not cached — balances move far more often than total supply.
 */
export async function fetchErc20Balance(
  chain: ChainKey,
  contract: string,
  holder: string,
  decimals = 18
): Promise<number | null> {
  const client = clientFor(chain);
  try {
    const raw = await client.readContract({
      address: contract as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [holder as `0x${string}`],
    });
    const divisor = parseUnits('1', decimals);
    const whole = raw / divisor;
    const frac = Number(raw % divisor) / Number(divisor);
    const total = Number(whole) + frac;
    return Number.isFinite(total) && total >= 0 ? total : null;
  } catch {
    return null;
  }
}
