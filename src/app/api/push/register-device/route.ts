import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ETH_ADDRESS_RE, verifySubscribeSignature } from '@/lib/push-auth';

// Native push device registration. The iOS app obtains an APNs token, has the
// user sign the push-subscribe message with their wallet, and posts both here.
// We bind token → address (so wallet-targeted alerts reach the device) and mark
// the address opted-in, all behind the same signature gate as /push/subscribe.

const VALID_PLATFORMS = new Set(['ios', 'android']);

/** POST /api/push/register-device { address, signature, token, platform? } */
export async function POST(request: NextRequest) {
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  let body: { address?: string; signature?: string; token?: string; platform?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { address, signature, token } = body;
  const platform = body.platform ?? 'ios';
  if (!address || !ETH_ADDRESS_RE.test(address) || !signature || !token) {
    return NextResponse.json({ error: 'Missing address, signature or token' }, { status: 400 });
  }
  if (!VALID_PLATFORMS.has(platform)) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }
  // APNs tokens are 64 hex chars; keep it permissive but bounded.
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  if (!(await verifySubscribeSignature(address, signature))) {
    return NextResponse.json({ error: 'Signature mismatch' }, { status: 403 });
  }

  const normalised = address.toLowerCase();

  // Binding a device implies opting in; do both so a single signature is enough.
  await db`
    INSERT INTO push_subscriptions (address, is_active)
    VALUES (${normalised}, TRUE)
    ON CONFLICT (address) DO UPDATE SET is_active = TRUE, subscribed_at = NOW()
  `;
  await db`
    INSERT INTO device_tokens (token, address, platform, is_active, last_seen_at)
    VALUES (${token}, ${normalised}, ${platform}, TRUE, NOW())
    ON CONFLICT (token) DO UPDATE
      SET address = ${normalised}, platform = ${platform}, is_active = TRUE, last_seen_at = NOW()
  `;

  return NextResponse.json({ registered: true });
}

/** DELETE /api/push/register-device { token } — unbind a device (logout/opt-out). */
export async function DELETE(request: NextRequest) {
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  await db`UPDATE device_tokens SET is_active = FALSE WHERE token = ${body.token}`;
  return NextResponse.json({ registered: false });
}
