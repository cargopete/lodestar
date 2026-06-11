// IPFS access for Subgraph Disassembly.
//
// A deployment ID *is* the IPFS hash of the compiled manifest, and the manifest
// references each compiled mapping WASM by IPFS hash. So for any published subgraph
// we fetch manifest + WASM straight from The Graph's IPFS gateway — no git, no build.

const IPFS_GATEWAY = 'https://ipfs.network.thegraph.com/api/v0/cat';

/** CIDv0 (Qm…) — the form deployment IDs and manifest file refs use. */
export const IPFS_HASH_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;

/** Cap WASM artifacts so a hostile/oversized manifest can't exhaust the function. */
const MAX_WASM_BYTES = 32 * 1024 * 1024;

async function ipfsFetch(hash: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${IPFS_GATEWAY}?arg=${encodeURIComponent(hash)}`, {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`IPFS gateway returned ${res.status} for ${hash}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a UTF-8 text artifact (the YAML manifest). */
export async function ipfsCatText(hash: string, timeoutMs = 15000): Promise<string> {
  const res = await ipfsFetch(hash, timeoutMs);
  return res.text();
}

/** Fetch a binary artifact (a compiled mapping WASM module). */
export async function ipfsCatBytes(hash: string, timeoutMs = 20000): Promise<Uint8Array> {
  const res = await ipfsFetch(hash, timeoutMs);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_WASM_BYTES) {
    throw new Error(`Artifact ${hash} is ${buf.byteLength} bytes (>${MAX_WASM_BYTES} cap)`);
  }
  return new Uint8Array(buf);
}
