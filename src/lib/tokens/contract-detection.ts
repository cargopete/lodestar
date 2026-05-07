/**
 * Classify holder addresses as contracts vs EOAs via `eth_getCode`.
 *
 * Token API's `/holders` endpoint lumps everything together as "wallets",
 * which makes top-10 concentration look catastrophic for tokens whose
 * supply sits in bridges, staking modules, vesting contracts, and LP
 * pools. We split the metric by checking whether each address has bytecode.
 *
 * Contract status is sticky for the lifetime of an address (selfdestruct
 * was effectively neutered by EIP-6780), so the result is cached in a
 * per-process Map indefinitely. One RPC round-trip per address per process.
 *
 * Tracked deficiency: TOKEN_API_NO_HOLDER_TYPE.
 */

import { createPublicClient, fallback, http, type PublicClient } from 'viem';
import { arbitrum, base, mainnet, optimism, polygon } from 'viem/chains';
import type { TokenChain } from './types';

type ChainKey = TokenChain | 'arbitrum' | 'base' | 'polygon' | 'optimism';

// Fallback list per chain. Public RPCs are unreliable individually:
// llamarpc occasionally returns "header not found" for `latest`,
// cloudflare returns transient "internal error" under load. The first
// healthy upstream wins; viem rotates on failure.
//
// Operators can prepend a private/paid RPC via env (e.g. MAINNET_RPC_URL)
// to bypass public-RPC throttling under load. The env-supplied URL is
// tried first; the public list is kept as fallback.
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

function rpcsFor(chain: ChainKey): string[] {
  const override = process.env[RPC_ENV[chain]];
  return override ? [override, ...PUBLIC_RPCS[chain]] : PUBLIC_RPCS[chain];
}

const CHAIN_DEFS = {
  mainnet,
  arbitrum,
  base,
  polygon,
  optimism,
} as const;

const clients = new Map<ChainKey, PublicClient>();
function clientFor(chain: ChainKey): PublicClient {
  const existing = clients.get(chain);
  if (existing) return existing;
  const transports = rpcsFor(chain).map((url) =>
    // 100ms batch wait coalesces the directory fan-out (51 tokens × 10
    // holders firing in the same tick) into a small number of large
    // JSON-RPC batches instead of 510 separate HTTP calls. Public RPCs
    // throttle on raw call count; a few fat batches sail through.
    http(url, { batch: { wait: 100, batchSize: 100 } })
  );
  const client = createPublicClient({
    chain: CHAIN_DEFS[chain],
    transport: fallback(transports, { rank: false, retryCount: 1 }),
  }) as PublicClient;
  clients.set(chain, client);
  return client;
}

// Process-scoped cache. Key: `${chain}:${lowercaseAddress}`. Contract status
// effectively never changes, so no TTL.
const cache = new Map<string, boolean>();

export async function classifyAddresses(
  chain: ChainKey,
  addresses: string[]
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const lowered = addresses.map((a) => a.toLowerCase());

  const misses: string[] = [];
  for (const addr of lowered) {
    const key = `${chain}:${addr}`;
    if (cache.has(key)) {
      out.set(addr, cache.get(key)!);
    } else {
      misses.push(addr);
    }
  }

  if (misses.length === 0) return out;

  const client = clientFor(chain);
  // viem's http transport coalesces parallel calls into JSON-RPC batches,
  // so Promise.all here = a small number of network round-trips. We retry
  // misses once (with a short jittered backoff) because public RPCs return
  // transient internal errors under load.
  async function callWithRetry(addr: string): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const code = await client.getCode({ address: addr as `0x${string}` });
        return code ?? '0x';
      } catch {
        if (attempt === 1) return null;
        await new Promise((r) => setTimeout(r, 250 + Math.random() * 250));
      }
    }
    return null;
  }
  const results = await Promise.all(misses.map(callWithRetry));

  results.forEach((code, i) => {
    const addr = misses[i];
    if (code == null) {
      // RPC failure after retry. Don't cache; callers treat absence in the
      // returned map as "unknown" rather than "EOA" so future loads can
      // attempt classification again.
      return;
    }
    // getCode returns '0x' for EOAs and longer bytecode hex for contracts.
    // EIP-7702 delegations also return bytecode (prefix `0xef01`), which is
    // the right thing to count as "not a plain wallet" for our purposes.
    const isContract = code !== '0x';
    cache.set(`${chain}:${addr}`, isContract);
    out.set(addr, isContract);
  });

  return out;
}
