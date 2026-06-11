import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ETH_ADDRESS_RE, verifySubscribeSignature } from '@/lib/push-auth';
import { apnsConfigured, sendToAddress } from '@/lib/apns';

// Self-targeted test push: a wallet owner fires a notification to their own
// registered devices. Signature-gated so you can only buzz your own phone —
// useful for validating the APNs pipe before real event dispatch exists.

/** POST /api/push/test { address, signature } */
export async function POST(request: NextRequest) {
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  if (!apnsConfigured()) return NextResponse.json({ error: 'APNs not configured' }, { status: 503 });

  let body: { address?: string; signature?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { address, signature } = body;
  if (!address || !ETH_ADDRESS_RE.test(address) || !signature) {
    return NextResponse.json({ error: 'Missing address or signature' }, { status: 400 });
  }
  if (!(await verifySubscribeSignature(address, signature))) {
    return NextResponse.json({ error: 'Signature mismatch' }, { status: 403 });
  }

  const delivered = await sendToAddress(address, {
    title: 'Lodestar',
    body: 'Push notifications are working. ⭐',
    path: '/',
    collapseId: 'lodestar-test',
  });

  return NextResponse.json({ delivered });
}
