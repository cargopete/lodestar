import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { verifyMessage } from 'viem';
import { type NextRequest, NextResponse } from 'next/server';

const COOKIE = 'studio_session';
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days
const AUTH_WINDOW = 300; // 5 minutes — max age of sign-in message

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET env var not set');
  if (s.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters (use a random 32+ byte value)');
  }
  return s;
}

// ---------------------------------------------------------------------------
// Deploy key helpers
// ---------------------------------------------------------------------------

export function generateDeployKey(): string {
  return randomBytes(32).toString('hex');
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// ---------------------------------------------------------------------------
// Session cookie — HMAC-signed, stateless
// ---------------------------------------------------------------------------

export function createSession(address: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${address.toLowerCase()}:${issuedAt}`;
  const sig = createHmac('sha256', secret()).update(payload).digest('hex');
  return `${payload}:${sig}`;
}

export function parseSession(token: string): string | null {
  const idx = token.lastIndexOf(':');
  if (idx < 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const parts = payload.split(':');
  if (parts.length !== 2) return null;
  const [address, issuedAtStr] = parts;
  const issuedAt = parseInt(issuedAtStr, 10);
  if (isNaN(issuedAt)) return null;
  if (Math.floor(Date.now() / 1000) - issuedAt > SESSION_TTL) return null;
  const expected = createHmac('sha256', secret()).update(payload).digest('hex');
  // Constant-time comparison to avoid leaking the signature via response timing.
  const expBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(sig);
  if (expBuf.length !== sigBuf.length || !timingSafeEqual(expBuf, sigBuf)) return null;
  return address;
}

export function getSessionAddress(req: NextRequest): string | null {
  const cookie = req.cookies.get(COOKIE)?.value;
  if (!cookie) return null;
  return parseSession(cookie);
}

export function setSessionCookie(res: NextResponse, address: string): void {
  res.cookies.set(COOKIE, createSession(address), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL,
    path: '/',
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.delete(COOKIE);
}

// ---------------------------------------------------------------------------
// Wallet signature verification
// ---------------------------------------------------------------------------

export function buildSignInMessage(address: string, timestamp: number): string {
  return `Sign in to Lodestar Studio\n\nAddress: ${address}\nTimestamp: ${timestamp}`;
}

export async function verifySignIn(
  address: string,
  message: string,
  signature: string,
): Promise<boolean> {
  // Validate the timestamp embedded in the message to prevent replay attacks
  const match = message.match(/Timestamp: (\d+)/);
  if (!match) return false;
  const ts = parseInt(match[1], 10);
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > AUTH_WINDOW) return false;

  try {
    return await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Route helper
// ---------------------------------------------------------------------------

export function requireAuth(req: NextRequest): { address: string } | NextResponse {
  const address = getSessionAddress(req);
  if (!address) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  return { address };
}
