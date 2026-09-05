/**
 * ENS names without the Graph gateway (nightswatchhq/nuthatch#1160).
 *
 * Reverse resolution on Ethereum mainnet through viem's `getEnsName`, which reads the address's
 * reverse record and verifies the forward record matches - the name's owner declared it, which is
 * what a display name should mean. The ENS subgraph this replaces answered a different question,
 * "which names resolve to this address", and the shortest of those was taken as the display name;
 * for an address with a primary name set the two agree, and for one without, the subgraph could
 * show a name its owner never chose to display. So the semantics move to the honest one on purpose.
 *
 * The client is mainnet with the same override-then-public transport pattern as `erc20-supply.ts`
 * (`MAINNET_RPC_URL` first). A failed lookup throws; callers decide whether that is a 503 or a name
 * left blank, and never turn it into "this address has no name" (#36).
 */
import { createPublicClient, fallback, http, type Address, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { cached } from './cache';

const PUBLIC_MAINNET_RPCS = ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com', 'https://cloudflare-eth.com'];

let client: PublicClient | null = null;
function mainnetClient(): PublicClient {
  if (client) return client;
  const override = process.env.MAINNET_RPC_URL;
  const urls = override ? [override, ...PUBLIC_MAINNET_RPCS] : PUBLIC_MAINNET_RPCS;
  client = createPublicClient({
    chain: mainnet,
    transport: fallback(urls.map((u) => http(u, { batch: { wait: 50, batchSize: 50 }, timeout: 10_000 })), { rank: false, retryCount: 1 }),
  }) as PublicClient;
  return client;
}

/** Test seam: swap the client. */
export function _setEnsClientForTests(c: PublicClient | null): void {
  client = c;
}

/** The address's primary ENS name, or null when it has none. Throws when the lookup itself fails. */
export async function resolveEnsName(address: string): Promise<string | null> {
  const addr = address.toLowerCase() as Address;
  return mainnetClient().getEnsName({ address: addr });
}

/**
 * Names for many addresses, each cached a day under the key the ENS route already used, so a route
 * and a cron asking about the same indexer share one lookup. Failures are per address: an address
 * whose lookup failed is absent from the result rather than present as null, so a caller can tell.
 */
export async function resolveEnsNames(addresses: string[], concurrency = 8): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((a) => cached<{ ensName: string | null }>(`ens:${a}`, 86400, async () => ({ ensName: await resolveEnsName(a) }))),
    );
    results.forEach((r, j) => {
      if (r.status === 'fulfilled' && r.value?.ensName) out[batch[j]] = r.value.ensName;
    });
  }
  return out;
}
