/**
 * Network Live — one snapshot, four data services, in parallel.
 *
 * Each field on this page is a real, TAP-metered paid query to a different
 * Horizon data service running on Lodestar infrastructure:
 *   - Dispatch   → JSON-RPC (Arbitrum One + Base) via the gateway
 *   - Camp       → decoded Arbitrum One (status + ERC-20 transfers) via TAP receipt
 *   - Seahorn    → structured Solana (Pump.fun buys) via TAP receipt
 *   - Substreams → streaming compute (clock-demo) via the sidecar shim
 *
 * Server-side so we can sign receipts without exposing a key and avoid CORS.
 */
import { NextResponse } from 'next/server';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GRAPH_TALLY_COLLECTOR = '0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e' as const;
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

const CAMP_DS = '0x8ED612666ad1853AdB050f4c4c54082decA605b8' as Hex;
const SEAHORN_DS = '0xdDE3F913cb6D1332Bc018Eb63647020a87dD7B37' as Hex;
const PROVIDER = '0xCfBB471617Ae3F6fDa2D9F142115d59deAB50C5b' as Hex;

const TAP_DOMAIN = { name: 'GraphTallyCollector', version: '1', chainId: 42161, verifyingContract: GRAPH_TALLY_COLLECTOR } as const;
const RECEIPT_TYPES = {
  Receipt: [
    { name: 'data_service', type: 'address' },
    { name: 'service_provider', type: 'address' },
    { name: 'timestamp_ns', type: 'uint64' },
    { name: 'nonce', type: 'uint64' },
    { name: 'value', type: 'uint128' },
    { name: 'metadata', type: 'bytes' },
  ],
} as const;

async function tapHeader(dataService: Hex): Promise<string> {
  const account = privateKeyToAccount(generatePrivateKey());
  const tsNs = BigInt(Math.trunc(Date.now() * 1_000_000));
  const nonce = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  const metadata = account.address.toLowerCase() as Hex;
  const value = 4_000_000_000_000n;
  const signature = await account.signTypedData({
    domain: TAP_DOMAIN,
    types: RECEIPT_TYPES,
    primaryType: 'Receipt',
    message: { data_service: dataService, service_provider: PROVIDER, timestamp_ns: tsNs, nonce, value, metadata },
  });
  return JSON.stringify({
    receipt: { data_service: dataService, service_provider: PROVIDER, timestamp_ns: Number(tsNs), nonce: Number(nonce), value: Number(value), metadata },
    signature,
  });
}

async function timed<T>(fn: () => Promise<T>) {
  const t0 = Date.now();
  try {
    const data = await fn();
    return { ok: true, latencyMs: Date.now() - t0, ...data } as Record<string, unknown> & { ok: true; latencyMs: number };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

const hexToNum = (h?: string) => (h ? parseInt(h, 16) : 0);

async function dispatchPanel() {
  const sig = AbortSignal.timeout(12_000);
  const call = async (chainId: number) => {
    const r = await fetch(`https://rpc.cargopete.com/rpc/${chainId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Consumer-Address': PROVIDER },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['latest', false] }),
      signal: sig,
    });
    const j = await r.json();
    const b = j.result ?? {};
    return {
      block: hexToNum(b.number),
      baseFeeGwei: hexToNum(b.baseFeePerGas) / 1e9,
      gasUsedPct: b.gasLimit ? (hexToNum(b.gasUsed) / hexToNum(b.gasLimit)) * 100 : 0,
      txCount: Array.isArray(b.transactions) ? b.transactions.length : 0,
      timestamp: hexToNum(b.timestamp),
    };
  };
  const [arbitrum, base] = await Promise.all([call(42161), call(8453)]);
  return { endpoint: 'rpc.cargopete.com/rpc/{42161,8453}', chains: { arbitrum, base } };
}

async function campPanel() {
  const sig = AbortSignal.timeout(15_000);
  const status = await (await fetch('https://camp.89.167.109.4.sslip.io/v1/status', { headers: { 'TAP-Receipt': await tapHeader(CAMP_DS) }, signal: sig })).json();
  const latest = Number(status.latest_indexed_block ?? 0);
  const from = Math.max(0, latest - 20000);
  const tr = await (await fetch(
    `https://camp.89.167.109.4.sslip.io/v1/transfers?token=${USDC}&from_block=${from}&to_block=${latest}&limit=4`,
    { headers: { 'TAP-Receipt': await tapHeader(CAMP_DS) }, signal: sig },
  )).json();
  return {
    endpoint: 'camp.89.167.109.4.sslip.io/v1/*',
    status: {
      latestIndexedBlock: latest,
      latestIndexedAt: status.latest_indexed_at,
      blocksIndexed: Number(status.blocks_indexed ?? 0),
    },
    transfers: (tr.transfers ?? []).map((t: Record<string, unknown>) => ({
      block: t.block_num, from: t.from, to: t.to, value: t.value, token: 'USDC', decimals: 6,
    })),
  };
}

async function seahornPanel() {
  const sig = AbortSignal.timeout(15_000);
  const j = await (await fetch('https://seahorn.89.167.109.4.sslip.io/buys?limit=5&order=slot.desc', { headers: { 'TAP-Receipt': await tapHeader(SEAHORN_DS) }, signal: sig })).json();
  return {
    endpoint: 'seahorn.89.167.109.4.sslip.io/buys',
    buys: (Array.isArray(j) ? j : []).map((b: Record<string, unknown>) => ({
      slot: b.slot, mint: b.mint, user: b.user, solCost: b.sol_cost, tokenAmount: b.token_amount, status: b.commitment_status,
    })),
  };
}

async function substreamsPanel() {
  const sig = AbortSignal.timeout(50_000);
  const j = await (await fetch('https://substreams.89.167.109.4.sslip.io/sample', { signal: sig })).json();
  return {
    endpoint: 'substreams.89.167.109.4.sslip.io/sample',
    package: j.package,
    module: j.module,
    blocks: (j.blocks ?? []).map((b: Record<string, unknown>) => ({
      block: b['@block'], timestamp: (b['@data'] as Record<string, unknown>)?.timestamp,
    })),
  };
}

async function mainlinePanel() {
  const sig = AbortSignal.timeout(50_000);
  const j = await (await fetch('https://mainline.89.167.109.4.sslip.io/sample', { signal: sig })).json();
  return {
    endpoint: 'mainline.89.167.109.4.sslip.io (gRPC firehose)',
    chain: j.chain,
    attestationsVerified: j.attestations_verified,
    blocks: (j.blocks ?? []).map((b: Record<string, unknown>) => ({ n: b.n, bytes: b.bytes, sha256: b.sha256 })),
  };
}

export async function GET() {
  const [dispatch, camp, seahorn, substreams, mainline] = await Promise.all([
    timed(dispatchPanel),
    timed(campPanel),
    timed(seahornPanel),
    timed(substreamsPanel),
    timed(mainlinePanel),
  ]);
  return NextResponse.json({ generatedAt: Date.now(), services: { dispatch, camp, seahorn, substreams, mainline } });
}
