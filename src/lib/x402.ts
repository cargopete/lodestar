/**
 * x402 pay-per-query support for The Graph's gateway.
 *
 * Why this exists: a freshly minted Subgraph Studio API key is not accepted by
 * the gateway for several minutes (measured at ~9m20s on 2026-08-18, see
 * nightswatchhq/graph-support#22). The gateway's x402 endpoints need no API key
 * at all, so they are the only way to query a published subgraph immediately.
 *
 * Why it is server-side: the gateway's CORS preflight does not permit the
 * `Payment-Signature` request header, and sets no `Access-Control-Expose-Headers`,
 * so a browser can neither send a payment nor read the 402 challenge. Verified
 * against the live gateway on 2026-08-18. Relaying is the only shape available.
 *
 * Custody: none. The browser signs an EIP-3009 authorisation naming the
 * gateway's own receiving address; we forward the bytes. We cannot redirect the
 * payment, and EIP-3009 nonces are single-use so a relayed signature buys
 * exactly one query.
 */

export type X402Network = 'mainnet' | 'testnet';

export interface X402Chain {
  /** Gateway origin serving the x402 endpoints. */
  gateway: string;
  /** CAIP-2 network id the challenge must name. */
  network: string;
  /** USDC contract the challenge must name. */
  asset: string;
  /** Address the payment must go to. Pinned; see assertChallengeIsExpected. */
  receiver: string;
  /** Refuse to relay a payment larger than this, in USDC base units (6dp). */
  maxAmount: bigint;
}

/**
 * Observed from the live gateways on 2026-08-18. The receiver is pinned rather
 * than trusted from the challenge: a substituted payTo would send a user's USDC
 * to an attacker, and that is not a risk worth carrying to save a redeploy. If
 * E&N rotates the address these constants must be updated, and the route will
 * fail loudly until they are.
 */
export const X402_CHAINS: Record<X402Network, X402Chain> = {
  mainnet: {
    gateway: 'https://gateway.thegraph.com',
    network: 'eip155:8453', // Base
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
    receiver: '0x79DC34E41B2b591078d3dE222C43EcaaBD52FcCB',
    maxAmount: 50_000n, // 0.05 USDC. List price is 0.01; this is a sanity bound.
  },
  testnet: {
    // NB: not `testnet.gateway.thegraph.com`, which appears in The Graph's own
    // docs and does not resolve.
    gateway: 'https://gateway.testnet.thegraph.com',
    network: 'eip155:84532', // Base Sepolia
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    receiver: '0x301672eEf23F0e5f165cfba26762702F20A74430',
    maxAmount: 1_000_000n, // testnet list price is 42 base units
  },
};

export function activeNetwork(): X402Network {
  return process.env.NEXT_PUBLIC_X402_NETWORK === 'testnet' ? 'testnet' : 'mainnet';
}

export function activeChain(): X402Chain {
  return X402_CHAINS[activeNetwork()];
}

/** Header the gateway reads the payment from. NOT `x-payment`. */
export const PAYMENT_HEADER = 'Payment-Signature';
/** Header the gateway returns the challenge in. */
export const CHALLENGE_HEADER = 'payment-required';
/** Header the gateway returns the settlement receipt in. */
export const SETTLE_HEADER = 'payment-response';

export type Target = { deployment: string } | { subgraphId: string };

const DEPLOYMENT_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const SUBGRAPH_HEX_RE = /^0x[0-9a-fA-F]{64}$/;
// GNS subgraph ids are also handed out base58-encoded, which is the form the
// Studio "query URL" uses.
const SUBGRAPH_B58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,46}$/;

/**
 * Validate the caller's target and build the upstream path. Identifiers are
 * checked before interpolation so a caller cannot inject path segments to reach
 * other gateway routes.
 */
export function resolveTargetPath(body: unknown): { path: string } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const deployment = typeof b.deployment === 'string' ? b.deployment : undefined;
  const subgraphId = typeof b.subgraphId === 'string' ? b.subgraphId : undefined;

  if (Boolean(deployment) === Boolean(subgraphId)) {
    return { error: 'Provide exactly one of "deployment" or "subgraphId"' };
  }
  if (deployment) {
    if (!DEPLOYMENT_RE.test(deployment)) {
      return { error: 'Invalid "deployment": expect an IPFS CIDv0 (Qm…)' };
    }
    return { path: `/api/x402/deployments/id/${deployment}` };
  }
  if (!SUBGRAPH_HEX_RE.test(subgraphId!) && !SUBGRAPH_B58_RE.test(subgraphId!)) {
    return { error: 'Invalid "subgraphId": expect 0x… (64 hex) or a base58 subgraph id' };
  }
  return { path: `/api/x402/subgraphs/id/${subgraphId}` };
}

export interface PriceTag {
  scheme: string;
  network: string;
  amount: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export interface Challenge {
  x402Version: number;
  error?: string;
  resource?: { url?: string };
  accepts: PriceTag[];
}

export function decodeChallenge(headerValue: string): Challenge | null {
  try {
    const json = Buffer.from(headerValue.trim(), 'base64').toString('utf8');
    const parsed = JSON.parse(json) as Challenge;
    return Array.isArray(parsed?.accepts) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Reject a challenge that does not match the chain we expect to be paying.
 *
 * This is the guard that stops a compromised or spoofed upstream from having a
 * user sign away USDC to somebody else. It runs before the challenge is handed
 * to the browser for signing.
 */
export function assertChallengeIsExpected(
  challenge: Challenge,
  chain: X402Chain,
): { ok: true; tag: PriceTag } | { ok: false; reason: string } {
  const tag = challenge.accepts.find((t) => t.network === chain.network);
  if (!tag) {
    return { ok: false, reason: `no price tag for ${chain.network}` };
  }
  if (tag.payTo?.toLowerCase() !== chain.receiver.toLowerCase()) {
    return { ok: false, reason: `unexpected payTo ${tag.payTo}` };
  }
  if (tag.asset?.toLowerCase() !== chain.asset.toLowerCase()) {
    return { ok: false, reason: `unexpected asset ${tag.asset}` };
  }
  let amount: bigint;
  try {
    amount = BigInt(tag.amount);
  } catch {
    return { ok: false, reason: `unparseable amount ${tag.amount}` };
  }
  if (amount <= 0n || amount > chain.maxAmount) {
    return { ok: false, reason: `amount ${tag.amount} outside accepted bounds` };
  }
  return { ok: true, tag };
}

/** Render a USDC base-unit amount (6dp) for display. */
export function formatUsdc(amount: string): string {
  const n = Number(amount) / 1e6;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}
