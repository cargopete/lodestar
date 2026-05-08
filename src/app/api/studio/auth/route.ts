import { type NextRequest, NextResponse } from 'next/server';
import {
  getSessionAddress,
  setSessionCookie,
  clearSessionCookie,
  verifySignIn,
} from '@/lib/studio/auth';

// GET — check current session
export async function GET(req: NextRequest) {
  const address = getSessionAddress(req);
  return NextResponse.json({ address: address ?? null });
}

// POST — sign in with wallet signature
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { address, message, signature } = body ?? {};

  if (!address || !message || !signature) {
    return NextResponse.json({ error: 'Missing address, message, or signature' }, { status: 400 });
  }

  const valid = await verifySignIn(address, message, signature);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid or expired signature' }, { status: 401 });
  }

  const res = NextResponse.json({ address: address.toLowerCase() });
  setSessionCookie(res, address);
  return res;
}

// DELETE — sign out
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
