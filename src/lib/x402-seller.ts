// Selling nuthatch data over x402: the other side of the counter.
//
// `x402.ts` is the buyer — it relays a payment to The Graph's gateway. This is the seller: it
// answers `402 Payment Required` with a price, and accepts a payment for one query. The suggestion
// came from Graphtronauts, and it is well aimed. TAP is the right rail for a Graph-native consumer
// with GRT, escrow and an on-chain relationship. For an agent that wants one answer, it is absurd
// overhead: x402 asks for a USDC balance and an HTTP header, and nothing else.
//
// **The wire format here is not read off a spec.** It is the shape observed from the live Graph
// gateway on 2026-08-18 and already parsed by `x402.ts` — same `payment-required` header, same
// base64 JSON, same `accepts` array. Selling in a format we have proven we can buy in is worth more
// than selling in one we have only read about.
//
// ## What is here and what is not
//
// Challenge generation and payment *verification* are here and tested. **Settlement is not.**
// Verifying an EIP-3009 authorisation proves the payer authorised a transfer; it does not move the
// money. Something has to submit it — a facilitator, or a funded key of ours — and until that is
// chosen and wired, a "paid" query would be one we never got paid for. So this refuses to run
// unless it is configured, and being unconfigured is the default.
//
// That is deliberate rather than unfinished: the missing half needs a receiving address and a
// custody decision, and neither is mine to make.

import { keccak256, encodeAbiParameters, recoverAddress, type Hex } from 'viem';

/** USDC on Base and Base Sepolia. Same constants the buyer side pinned from live observation. */
export const SELLER_CHAINS = {
  mainnet: {
    network: 'eip155:8453',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    assetName: 'USD Coin',
    assetVersion: '2',
    chainId: 8453,
  },
  testnet: {
    network: 'eip155:84532',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    assetName: 'USDC',
    assetVersion: '2',
    chainId: 84532,
  },
} as const;

export type SellerNetwork = keyof typeof SELLER_CHAINS;

export interface SellerConfig {
  network: SellerNetwork;
  /** Where the money goes. No default, and no paywall without one. */
  payTo: string;
  /** Price for one query, in USDC base units (6dp). */
  priceBaseUnits: bigint;
}

/**
 * Read the seller configuration, or nothing.
 *
 * Absent configuration means the surface stays free, which is the current behaviour and the safe
 * default. A half-configured paywall — a price with nowhere to send the money — is refused rather
 * than guessed at, because the failure would be invisible: queries would be charged for and nothing
 * would arrive.
 */
export function sellerConfig(): SellerConfig | null {
  const payTo = process.env.X402_SELL_PAY_TO;
  if (!payTo) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
    throw new Error('X402_SELL_PAY_TO must be a 20-byte address');
  }
  const network: SellerNetwork = process.env.X402_SELL_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
  const price = BigInt(process.env.X402_SELL_PRICE ?? '1000'); // 0.001 USDC
  if (price <= 0n) throw new Error('X402_SELL_PRICE must be positive');
  return { network, payTo, priceBaseUnits: price };
}

export interface PriceTag {
  scheme: string;
  network: string;
  amount: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds: number;
  resource: string;
  description: string;
  extra: { name: string; version: string };
}

/** The body of a `402`, in the shape the buyer side already knows how to read. */
export function buildChallenge(cfg: SellerConfig, resource: string, description: string) {
  const chain = SELLER_CHAINS[cfg.network];
  return {
    x402Version: 1,
    error: 'Payment required',
    resource: { url: resource },
    accepts: [
      {
        scheme: 'exact',
        network: chain.network,
        amount: cfg.priceBaseUnits.toString(),
        payTo: cfg.payTo,
        asset: chain.asset,
        maxTimeoutSeconds: 60,
        resource,
        description,
        extra: { name: chain.assetName, version: chain.assetVersion },
      } satisfies PriceTag,
    ],
  };
}

/** Base64, because that is how the header carries it. */
export function encodeChallenge(challenge: unknown): string {
  return Buffer.from(JSON.stringify(challenge), 'utf8').toString('base64');
}

/** An EIP-3009 `TransferWithAuthorization`, as an x402 `exact` payment carries it. */
export interface PaymentPayload {
  x402Version?: number;
  scheme?: string;
  network?: string;
  payload?: {
    signature?: string;
    authorization?: {
      from?: string;
      to?: string;
      value?: string;
      validAfter?: string;
      validBefore?: string;
      nonce?: string;
    };
  };
}

export type VerifyResult =
  | { ok: true; from: string; value: bigint; nonce: string }
  | { ok: false; reason: string };

const TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
  '0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267' as Hex;

/**
 * Recover the EIP-712 digest an EIP-3009 authorisation is signed over.
 *
 * Written out rather than pulled from a helper because getting it wrong produces a signature that
 * recovers to *some* address — just not the payer's — and the failure looks like a forged payment
 * rather than like our bug. The same trap as the RCA hashing in weaver, and the same remedy:
 * separate tests, and a fixture.
 */
function authorizationDigest(
  chainId: number,
  verifyingContract: Hex,
  name: string,
  version: string,
  a: { from: Hex; to: Hex; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex }
): Hex {
  const domainTypeHash = keccak256(
    Buffer.from('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
  );
  const domainSeparator = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [
        domainTypeHash,
        keccak256(Buffer.from(name)),
        keccak256(Buffer.from(version)),
        BigInt(chainId),
        verifyingContract,
      ]
    )
  );
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'bytes32' },
      ],
      [
        TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
        a.from,
        a.to,
        a.value,
        a.validAfter,
        a.validBefore,
        a.nonce,
      ]
    )
  );
  return keccak256(`0x1901${domainSeparator.slice(2)}${structHash.slice(2)}` as Hex);
}

/**
 * Check that a presented payment authorises what we asked for.
 *
 * Every field is checked against **our** configuration rather than against the payment's own
 * claims. A payment naming a different `payTo` is not a payment to us however well signed it is,
 * and a payment for less than the price is not a payment for this query.
 */
export async function verifyPayment(
  cfg: SellerConfig,
  headerValue: string,
  now = Math.floor(Date.now() / 1000)
): Promise<VerifyResult> {
  const chain = SELLER_CHAINS[cfg.network];

  let parsed: PaymentPayload;
  try {
    parsed = JSON.parse(Buffer.from(headerValue.trim(), 'base64').toString('utf8'));
  } catch {
    return { ok: false, reason: 'payment header is not base64 JSON' };
  }

  const auth = parsed.payload?.authorization;
  const sig = parsed.payload?.signature;
  if (!auth || !sig) return { ok: false, reason: 'payment carries no authorization' };
  if (parsed.scheme && parsed.scheme !== 'exact') {
    return { ok: false, reason: `unsupported scheme ${parsed.scheme}` };
  }
  if (parsed.network && parsed.network !== chain.network) {
    return { ok: false, reason: `payment is for ${parsed.network}, not ${chain.network}` };
  }

  const { from, to, value, validAfter, validBefore, nonce } = auth;
  if (!from || !to || !value || !validAfter || !validBefore || !nonce) {
    return { ok: false, reason: 'authorization is missing fields' };
  }
  if (to.toLowerCase() !== cfg.payTo.toLowerCase()) {
    return { ok: false, reason: 'authorization pays somebody else' };
  }

  let amount: bigint;
  try {
    amount = BigInt(value);
  } catch {
    return { ok: false, reason: 'unparseable amount' };
  }
  if (amount < cfg.priceBaseUnits) {
    return { ok: false, reason: `authorized ${value}, price is ${cfg.priceBaseUnits}` };
  }

  // A window that has not opened or has closed is not a payment we can settle, and accepting one
  // would mean serving a query against an authorisation the token will refuse.
  if (now < Number(validAfter)) return { ok: false, reason: 'authorization is not yet valid' };
  if (now > Number(validBefore)) return { ok: false, reason: 'authorization has expired' };

  let recovered: string;
  try {
    const digest = authorizationDigest(
      chain.chainId,
      chain.asset as Hex,
      chain.assetName,
      chain.assetVersion,
      {
        from: from as Hex,
        to: to as Hex,
        value: amount,
        validAfter: BigInt(validAfter),
        validBefore: BigInt(validBefore),
        nonce: nonce as Hex,
      }
    );
    recovered = await recoverAddress({ hash: digest, signature: sig as Hex });
  } catch (e) {
    return { ok: false, reason: `signature did not recover: ${String(e)}` };
  }

  if (recovered.toLowerCase() !== from.toLowerCase()) {
    return { ok: false, reason: 'signature does not match the stated payer' };
  }

  return { ok: true, from, value: amount, nonce };
}
