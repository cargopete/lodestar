import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyMessage } from 'viem';

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function subscribeMessage(address: string): string {
  return `Subscribe to Lodestar notifications\n\nAddress: ${address.toLowerCase()}`;
}

/** GET /api/push/subscribe?address=0x... — check subscription status */
export async function GET(request: NextRequest) {
  if (!db) return NextResponse.json({ subscribed: false });

  const address = request.nextUrl.searchParams.get('address')?.toLowerCase();
  if (!address || !ETH_ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  const rows = await db`
    SELECT is_active FROM push_subscriptions WHERE address = ${address}
  `;

  return NextResponse.json({ subscribed: rows.length > 0 && rows[0].is_active });
}

/** POST /api/push/subscribe — opt in with signed message proof */
export async function POST(request: NextRequest) {
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  let body: { address: string; signature: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { address, signature } = body;
  if (!address || !ETH_ADDRESS_RE.test(address) || !signature) {
    return NextResponse.json({ error: 'Missing address or signature' }, { status: 400 });
  }

  const normalised = address.toLowerCase() as `0x${string}`;

  // Verify the EIP-191 personal sign
  let valid = false;
  try {
    valid = await verifyMessage({
      address: normalised,
      message: subscribeMessage(normalised),
      signature: signature as `0x${string}`,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (!valid) {
    return NextResponse.json({ error: 'Signature mismatch' }, { status: 403 });
  }

  await db`
    INSERT INTO push_subscriptions (address, is_active)
    VALUES (${normalised}, TRUE)
    ON CONFLICT (address) DO UPDATE SET is_active = TRUE, subscribed_at = NOW()
  `;

  return NextResponse.json({ subscribed: true });
}

/** DELETE /api/push/subscribe — opt out. Requires an EIP-191 signature over the
 * subscribe message so a caller can only unsubscribe their OWN address. */
export async function DELETE(request: NextRequest) {
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  let body: { address?: string; signature?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const address = body.address?.toLowerCase();
  const signature = body.signature;
  if (!address || !ETH_ADDRESS_RE.test(address) || !signature) {
    return NextResponse.json({ error: 'Missing address or signature' }, { status: 400 });
  }

  const normalised = address as `0x${string}`;
  let valid = false;
  try {
    valid = await verifyMessage({
      address: normalised,
      message: subscribeMessage(normalised),
      signature: signature as `0x${string}`,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }
  if (!valid) {
    return NextResponse.json({ error: 'Signature mismatch' }, { status: 403 });
  }

  await db`
    UPDATE push_subscriptions SET is_active = FALSE WHERE address = ${normalised}
  `;

  return NextResponse.json({ subscribed: false });
}

export { subscribeMessage };
