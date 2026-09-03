import { decodeBase58, encodeBase58, toBeHex } from 'ethers';

// The Graph's public IPFS endpoint — used as default when GRAPH_IPFS_URL is not set
export const THEGRAPH_IPFS = 'https://api.thegraph.com/ipfs';

export function ipfsEndpoint(): string {
  return process.env.GRAPH_IPFS_URL?.replace(/\/$/, '') ?? THEGRAPH_IPFS;
}

/**
 * Convert a CIDv0 IPFS hash (Qm...) to a bytes32 hex string as used by
 * The Graph Protocol's GNS contract.
 *
 * CIDv0 is base58-encoded multihash: [0x12, 0x20, <32-byte SHA-256>]
 * The contract expects just the 32-byte SHA-256 part.
 */
export function ipfsHashToBytes32(ipfsHash: string): `0x${string}` {
  const n = decodeBase58(ipfsHash);
  // toBeHex pads to exactly 34 bytes (68 hex chars) = "0x" + "1220" + 64 chars
  const hex = toBeHex(n, 34);
  // Strip the 0x1220 multihash prefix (first 2 bytes = 4 hex chars after "0x")
  return `0x${hex.slice(6)}` as `0x${string}`;
}

/**
 * The inverse: a deployment's bytes32 id back to its CIDv0 hash, which is what the subgraph
 * exposes as `ipfsHash` and what every link and label in the app is built from. Round-trips with
 * `ipfsHashToBytes32`; a real vector is pinned in the tests.
 */
export function bytes32ToIpfsHash(id: `0x${string}` | string): string {
  const hex = id.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`not a bytes32 id: ${id}`);
  return encodeBase58(`0x1220${hex}`);
}

/**
 * Upload a JSON object to IPFS.
 * Returns the CIDv0 IPFS hash (Qm...) or null on failure.
 */
export async function uploadJsonToIpfs(data: object): Promise<string | null> {
  const endpoint = ipfsEndpoint();
  try {
    const form = new FormData();
    form.append(
      'file',
      new Blob([JSON.stringify(data)], { type: 'application/json' }),
      'metadata.json',
    );
    const res = await fetch(`${endpoint}/api/v0/add?pin=true`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.Hash as string;
  } catch {
    return null;
  }
}
