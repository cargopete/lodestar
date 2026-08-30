import { NextResponse } from 'next/server';
import {
  buildChallenge,
  encodeChallenge,
  sellerConfig,
  verifyPayment,
  type SellerConfig,
} from './x402-seller';
import { log } from './logger';

// The counter: a `402` with a price, and a signed authorisation that buys one answer.
//
// Wired to the **named** query tier only, and that is a design decision rather than a limit of the
// implementation. A declared, pinned query has a shape and a cost knowable in advance, so it can be
// quoted; arbitrary SQL has a cost profile a caller discovers by trying things, which is unquotable.
// RFC-0034 makes the same argument for bounding the surface at all.
//
// ## Verify at the counter, settle in the back office
//
// The x402 reference flow asks a facilitator to verify and settle before serving. That is wrong
// here for two reasons that are the same reason twice: it puts a third-party call in the request
// path, and it hands the timing and frequency of every paid question to somebody else. So this
// verifies the authorisation **entirely locally** — signature, recipient, amount, window, network,
// all arithmetic over bytes already in hand — serves the answer, and records the authorisation for
// an operator-side settler to submit later.
//
// **What that concedes, stated rather than hidden:** a verified authorisation is a promise. One that
// later fails bought a query nobody paid for. The loss is bounded to one query's price, the payer is
// named by their own signature, and a per-payer record lets an operator refuse somebody whose
// promises do not clear. A shop, not a vending machine.
//
// ## Off unless configured
//
// No `X402_SELL_PAY_TO`, no paywall, and the surface behaves exactly as it does today. That is the
// default and it is the state this ships in: taking money needs an address and a price, and neither
// is invented here.

export interface GateResult {
  /** A 402 to return instead of serving. Absent means the caller may proceed. */
  challenge?: NextResponse;
  /** Present when a payment was accepted, for the caller to record alongside what it served. */
  accepted?: { from: string; value: string; nonce: string };
}

/**
 * Decide whether this request has paid.
 *
 * Returns a `402` carrying the price when payment is required and absent or bad; returns nothing
 * when the surface is free or the payment is good.
 */
export async function x402Gate(req: Request, resource: string, description: string): Promise<GateResult> {
  let cfg: SellerConfig | null;
  try {
    cfg = sellerConfig();
  } catch (e) {
    // A half-configured paywall is refused rather than guessed at: a price with nowhere to send the
    // money would charge for queries and deliver nothing, invisibly.
    log.api.error({ err: e }, 'x402 seller configuration is invalid');
    return {};
  }
  if (!cfg) return {};

  const presented = req.headers.get('Payment-Signature');
  if (!presented) {
    return { challenge: priceRequired(cfg, resource, description) };
  }

  const verdict = await verifyPayment(cfg, presented);
  if (!verdict.ok) {
    // The reason is returned. A bare "payment rejected" sends a paying customer to debug the wrong
    // thing, and the reasons here are all things they can act on: wrong recipient, too little,
    // expired, wrong chain.
    return {
      challenge: priceRequired(cfg, resource, `${description} — previous payment rejected: ${verdict.reason}`),
    };
  }

  return {
    accepted: { from: verdict.from, value: verdict.value.toString(), nonce: verdict.nonce },
  };
}

function priceRequired(cfg: SellerConfig, resource: string, description: string): NextResponse {
  const challenge = buildChallenge(cfg, resource, description);
  return NextResponse.json(
    {
      error: 'Payment required',
      // Repeated in the body as well as the header because a `402` a caller cannot read is a `402`
      // they cannot pay, and not every client surfaces response headers.
      accepts: challenge.accepts,
    },
    {
      status: 402,
      headers: {
        'payment-required': encodeChallenge(challenge),
        // Without this a browser cannot read the challenge it is being asked to pay, which is the
        // exact wall our own buyer-side code hit against The Graph's gateway on 2026-08-18.
        'Access-Control-Expose-Headers': 'payment-required',
      },
    }
  );
}
