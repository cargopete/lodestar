/**
 * Keyless pay-per-query proxy to The Graph's gateway (x402).
 *
 * POST /api/x402/query
 * Body: { deployment?: string, subgraphId?: string, query: string, variables?: unknown }
 * Optional request header: `Payment-Signature` (produced by the caller's wallet)
 *
 * Without a payment header the gateway answers 402 and we hand the decoded
 * challenge back so the caller can sign it. With one, we relay it verbatim and
 * return the gateway's response.
 *
 * This route deliberately does NOT use GRAPH_API_KEY. Its whole purpose is to
 * work when no usable API key exists — see src/lib/x402.ts for why.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { log } from '@/lib/logger';
import {
  CHALLENGE_HEADER,
  PAYMENT_HEADER,
  SETTLE_HEADER,
  activeChain,
  activeNetwork,
  assertChallengeIsExpected,
  decodeChallenge,
  formatUsdc,
  resolveTargetPath,
} from '@/lib/x402';

const UPSTREAM_TIMEOUT_MS = 20_000;
const MAX_QUERY_CHARS = 100_000;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const target = resolveTargetPath(body);
  if ('error' in target) {
    return NextResponse.json({ error: target.error }, { status: 400 });
  }

  const { query, variables } = (body ?? {}) as { query?: unknown; variables?: unknown };
  if (typeof query !== 'string' || !query.trim()) {
    return NextResponse.json({ error: 'Missing "query"' }, { status: 400 });
  }
  if (query.length > MAX_QUERY_CHARS) {
    return NextResponse.json({ error: 'Query too large' }, { status: 413 });
  }

  const chain = activeChain();
  const url = `${chain.gateway}${target.path}`;

  // Relayed verbatim when present. Never logged: it carries a signature that
  // authorises a USDC transfer.
  const payment = req.headers.get(PAYMENT_HEADER);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(payment ? { [PAYMENT_HEADER]: payment } : {}),
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.api.error({ err: reason, network: activeNetwork() }, 'x402 upstream fetch failed');
    return NextResponse.json({ error: 'Gateway upstream request failed' }, { status: 502 });
  }

  if (upstream.status === 402) {
    const raw = upstream.headers.get(CHALLENGE_HEADER);
    const challenge = raw ? decodeChallenge(raw) : null;
    if (!challenge) {
      log.api.error({ network: activeNetwork() }, 'x402 challenge missing or undecodable');
      return NextResponse.json({ error: 'Gateway sent an unreadable payment challenge' }, { status: 502 });
    }

    // Refuse to show the user anything we would not be willing to have them
    // sign. A substituted payTo is the one failure here that costs real money.
    const check = assertChallengeIsExpected(challenge, chain);
    if (!check.ok) {
      log.api.error(
        { reason: check.reason, network: activeNetwork() },
        'x402 challenge rejected by policy',
      );
      return NextResponse.json(
        { error: 'Gateway payment terms did not match expectations; refusing to relay', detail: check.reason },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        needsPayment: true,
        // Relayed so the caller's x402 client can parse it exactly as it would
        // have from the gateway directly.
        challengeHeader: raw,
        priceTag: check.tag,
        priceUsdc: formatUsdc(check.tag.amount),
        network: activeNetwork(),
        // The gateway's own error string, e.g. "Payment-Signature header is
        // required" or "Invalid or malformed payment header".
        gatewayMessage: challenge.error,
      },
      { status: 402 },
    );
  }

  let data: unknown;
  try {
    data = await upstream.json();
  } catch {
    log.api.error({ status: upstream.status }, 'x402 upstream returned non-JSON');
    return NextResponse.json({ error: 'Gateway returned an unreadable response' }, { status: 502 });
  }

  const settle = upstream.headers.get(SETTLE_HEADER);
  const res = NextResponse.json(data, { status: upstream.ok ? 200 : upstream.status });
  if (settle) {
    // Lets the caller confirm the payment actually settled rather than
    // inferring it from a 200.
    res.headers.set(SETTLE_HEADER, settle);
  }
  return res;
}
