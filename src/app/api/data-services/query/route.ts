/**
 * Live "playground" proxy for Horizon data services.
 *
 * Runs a real sample query against a deployed data-service provider and returns
 * the result. Server-side so we can (a) avoid browser CORS, and (b) sign a TAP
 * receipt without exposing any key to the client.
 *
 * - Dispatch  → queried through the Lodestar gateway, which pays + signs on our
 *               behalf (only an X-Consumer-Address header is needed).
 * - Camp / Seahorn → gated by an EIP-712 TAP v2 receipt. The providers accept
 *               receipts from any signer (authorized_senders is open), so we
 *               sign with an ephemeral key per request — no escrow needed just
 *               to read. Real settlement still requires the payer's escrow.
 */
import { NextResponse } from 'next/server';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GRAPH_TALLY_COLLECTOR = '0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e' as const;

const TAP_DOMAIN = {
  name: 'GraphTallyCollector',
  version: '1',
  chainId: 42161,
  verifyingContract: GRAPH_TALLY_COLLECTOR,
} as const;

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

type JsonRpcSpec = {
  kind: 'jsonrpc';
  url: string;
  consumer: string;
  body: unknown;
};
type RestTapSpec = {
  kind: 'rest-tap';
  url: string;
  dataService: Hex;
  serviceProvider: Hex;
};
// Substreams is gRPC — a shim on the provider box runs the CLI through the
// consumer sidecar and returns a few clock blocks as JSON over plain HTTP.
type ShimSpec = { kind: 'shim'; url: string };
type QuerySpec = JsonRpcSpec | RestTapSpec | ShimSpec;

// Server-authoritative registry — the client only sends a slug.
const REGISTRY: Record<string, QuerySpec> = {
  dispatch: {
    kind: 'jsonrpc',
    url: 'https://rpc.cargopete.com/rpc/42161',
    consumer: '0xB70781305939A39e74Aa918416Df1b893e1Bd904',
    body: { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] },
  },
  'camp-data-service': {
    kind: 'rest-tap',
    url: 'https://camp.89.167.109.4.sslip.io/v1/status',
    dataService: '0x8ED612666ad1853AdB050f4c4c54082decA605b8',
    serviceProvider: '0xCfBB471617Ae3F6fDa2D9F142115d59deAB50C5b',
  },
  seahorn: {
    kind: 'rest-tap',
    url: 'https://seahorn.89.167.109.4.sslip.io/buys?limit=3&order=slot.desc',
    dataService: '0xdDE3F913cb6D1332Bc018Eb63647020a87dD7B37',
    serviceProvider: '0xCfBB471617Ae3F6fDa2D9F142115d59deAB50C5b',
  },
  sdsce: {
    kind: 'shim',
    url: 'https://substreams.89.167.109.4.sslip.io/sample',
  },
};

async function signReceipt(dataService: Hex, serviceProvider: Hex): Promise<string> {
  const account = privateKeyToAccount(generatePrivateKey());
  const tsNs = BigInt(Math.trunc(Date.now() * 1_000_000));
  const nonce = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  const metadata = account.address.toLowerCase() as Hex; // payer = first 20 bytes
  const value = 4_000_000_000_000n; // 4e-6 GRT (1 CU) — declared, not settled here

  const message = {
    data_service: dataService,
    service_provider: serviceProvider,
    timestamp_ns: tsNs,
    nonce,
    value,
    metadata,
  };
  const signature = await account.signTypedData({
    domain: TAP_DOMAIN,
    types: RECEIPT_TYPES,
    primaryType: 'Receipt',
    message,
  });
  return JSON.stringify({
    receipt: {
      data_service: dataService,
      service_provider: serviceProvider,
      timestamp_ns: Number(tsNs),
      nonce: Number(nonce),
      value: Number(value),
      metadata,
    },
    signature,
  });
}

export async function POST(req: Request) {
  let slug: string;
  try {
    ({ slug } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid request body' }, { status: 400 });
  }

  const spec = REGISTRY[slug];
  if (!spec) {
    return NextResponse.json({ ok: false, error: `no live playground for "${slug}"` }, { status: 404 });
  }

  const started = Date.now();
  const ctl = AbortSignal.timeout(spec.kind === 'shim' ? 50_000 : 15_000);

  try {
    let res: Response;
    if (spec.kind === 'jsonrpc') {
      res = await fetch(spec.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Consumer-Address': spec.consumer },
        body: JSON.stringify(spec.body),
        signal: ctl,
      });
    } else if (spec.kind === 'shim') {
      res = await fetch(spec.url, { signal: ctl });
    } else {
      const receipt = await signReceipt(spec.dataService, spec.serviceProvider);
      res = await fetch(spec.url, { headers: { 'TAP-Receipt': receipt }, signal: ctl });
    }

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }

    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - started,
      endpoint: spec.url,
      result: parsed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg.includes('timeout') ? 'request timed out' : msg, durationMs: Date.now() - started },
      { status: 502 },
    );
  }
}
