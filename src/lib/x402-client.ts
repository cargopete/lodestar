/**
 * Browser half of the keyless x402 query flow.
 *
 * The user's wallet signs an EIP-3009 authorisation; the signature travels to
 * our relay at /api/x402/query, which forwards it to The Graph's gateway. The
 * relay exists only because the gateway's CORS policy forbids the browser from
 * sending `Payment-Signature` or reading the challenge (see src/lib/x402.ts).
 *
 * Nothing here is custodial. The authorisation names the gateway's own
 * receiving address and an exact amount, and its nonce is single-use, so the
 * relay can neither redirect the payment nor replay it.
 *
 * Signing costs no gas. The payer needs USDC on Base and nothing else.
 */
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';

/** Minimum a signer must provide. A viem/wagmi wallet client satisfies this. */
export interface X402Signer {
  address: `0x${string}`;
  signTypedData(message: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;
}

/**
 * Adapt a wagmi/viem wallet client to the signer shape x402 expects.
 *
 * viem's `signTypedData` wants an explicit `account`, which the x402 signer
 * interface does not pass, so it is bound here.
 */
export function toX402Signer(walletClient: {
  account: { address: `0x${string}` };
  // Method syntax on purpose: it is bivariant, so viem's overloaded
  // signTypedData satisfies it where an arrow property would not.
  signTypedData(args: never): Promise<`0x${string}`>;
}): X402Signer {
  return {
    address: walletClient.account.address,
    signTypedData: (message) =>
      walletClient.signTypedData({
        account: walletClient.account,
        ...message,
      } as never),
  };
}

/**
 * Chain ids for signing. Kept here rather than imported from src/lib/x402.ts so
 * the browser bundle does not pull in that module's Node `Buffer` use.
 */
export const X402_CHAIN_IDS = { mainnet: 8453, testnet: 84532 } as const;

export function activeX402Network(): 'mainnet' | 'testnet' {
  return process.env.NEXT_PUBLIC_X402_NETWORK === 'testnet' ? 'testnet' : 'mainnet';
}

export function activeX402ChainId(): (typeof X402_CHAIN_IDS)[keyof typeof X402_CHAIN_IDS] {
  return X402_CHAIN_IDS[activeX402Network()];
}

export function activeX402ChainLabel(): string {
  return activeX402Network() === 'testnet' ? 'Base Sepolia' : 'Base';
}

export type X402Target = { deployment: string } | { subgraphId: string };

export interface QuoteResult {
  /** Base units of USDC (6dp). */
  amount: string;
  /** Human-readable, e.g. "0.01". */
  priceUsdc: string;
  network: string;
  payTo: string;
  /** Opaque; hand straight back to `payAndQuery`. */
  challengeHeader: string;
}

export class X402Error extends Error {}

const RELAY = '/api/x402/query';

function post(body: unknown, headers: Record<string, string> = {}) {
  return fetch(RELAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/**
 * Ask what a query would cost, without paying or signing anything.
 *
 * Returns null if the gateway served the query without asking for payment,
 * which should not happen on the x402 endpoints but is not worth throwing over.
 */
export async function quote(
  target: X402Target,
  query: string,
  variables?: unknown,
): Promise<QuoteResult | null> {
  const res = await post({ ...target, query, variables });
  if (res.status !== 402) {
    if (res.ok) return null;
    throw new X402Error(await errorText(res));
  }
  const body = await res.json();
  return {
    amount: body.priceTag.amount,
    priceUsdc: body.priceUsdc,
    network: body.priceTag.network,
    payTo: body.priceTag.payTo,
    challengeHeader: body.challengeHeader,
  };
}

/**
 * Sign a payment for a previously fetched quote and run the query.
 *
 * Split from `quote` on purpose: the caller should be able to show the price
 * and get a deliberate confirmation before a wallet prompt appears.
 */
export async function payAndQuery<T = unknown>(
  target: X402Target,
  query: string,
  opts: { signer: X402Signer; quote: QuoteResult; variables?: unknown },
): Promise<T> {
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: opts.signer });
  const http = new x402HTTPClient(client);

  // Reconstruct the challenge exactly as the gateway sent it, so the payment is
  // built against the gateway's own terms rather than anything we reshaped.
  const required = http.getPaymentRequiredResponse((name) =>
    name.toLowerCase() === 'payment-required' ? opts.quote.challengeHeader : null,
  );

  const paymentHeaders = await http.handlePaymentRequired(required);
  if (!paymentHeaders) {
    throw new X402Error('Wallet did not produce a payment authorisation');
  }

  const res = await post({ ...target, query, variables: opts.variables }, paymentHeaders);
  if (res.status === 402) {
    const body = await res.json().catch(() => ({}));
    throw new X402Error(body.gatewayMessage ?? 'Payment was rejected by the gateway');
  }
  if (!res.ok) throw new X402Error(await errorText(res));

  return (await res.json()) as T;
}

/** Convenience: quote and pay in one step, with no confirmation gate. */
export async function queryWithPayment<T = unknown>(
  target: X402Target,
  query: string,
  opts: { signer: X402Signer; variables?: unknown },
): Promise<T> {
  const q = await quote(target, query, opts.variables);
  if (!q) throw new X402Error('Gateway did not request payment');
  return payAndQuery<T>(target, query, { ...opts, quote: q });
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body.detail ? `${body.error}: ${body.detail}` : (body.error ?? `HTTP ${res.status}`);
  } catch {
    return `HTTP ${res.status}`;
  }
}
