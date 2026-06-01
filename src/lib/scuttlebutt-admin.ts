import { createHmac, timingSafeEqual } from 'crypto';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Admin auth for Scuttlebutt (Chief only).
 *
 * Mirrors src/lib/studio/auth.ts: a stateless HMAC-signed cookie, verified in
 * constant time. Login compares a typed password against SCUTTLEBUTT_ADMIN_SECRET
 * (timing-safe, fail-closed). The cookie is signed with the existing SESSION_SECRET.
 */

const COOKIE = 'sb_admin';
const TTL = 60 * 60 * 24 * 7; // 7 days

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters');
  }
  return s;
}

/** Constant-time comparison of two strings via equal-length buffers. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Check a login password against SCUTTLEBUTT_ADMIN_SECRET. Fails closed. */
export function checkAdminPassword(password: string): boolean {
  const secret = process.env.SCUTTLEBUTT_ADMIN_SECRET;
  if (!secret) return false; // fail closed — no secret set, no admin
  return safeEqual(password, secret);
}

export function createAdminToken(): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `admin:${issuedAt}`;
  const sig = createHmac('sha256', sessionSecret()).update(payload).digest('hex');
  return `${payload}:${sig}`;
}

export function verifyAdminToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const idx = token.lastIndexOf(':');
  if (idx < 0) return false;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const parts = payload.split(':');
  if (parts.length !== 2 || parts[0] !== 'admin') return false;
  const issuedAt = parseInt(parts[1], 10);
  if (isNaN(issuedAt)) return false;
  if (Math.floor(Date.now() / 1000) - issuedAt > TTL) return false;
  let expected: string;
  try {
    expected = createHmac('sha256', sessionSecret()).update(payload).digest('hex');
  } catch {
    return false; // secret misconfigured -> fail closed
  }
  return safeEqual(expected, sig);
}

export function isAdmin(req: NextRequest): boolean {
  return verifyAdminToken(req.cookies.get(COOKIE)?.value);
}

export function setAdminCookie(res: NextResponse): void {
  res.cookies.set(COOKIE, createAdminToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: TTL,
    path: '/',
  });
}

export function clearAdminCookie(res: NextResponse): void {
  res.cookies.delete(COOKIE);
}

/**
 * CSRF guard for cookie-authed mutations: require a custom header the browser
 * will not attach to a cross-site form submission. SameSite=Strict already
 * blocks most cross-site sends; this is belt-and-braces.
 */
export function hasCsrfHeader(req: NextRequest): boolean {
  return req.headers.get('x-sb-admin') === '1';
}

/**
 * Gate an admin route. Returns a NextResponse to short-circuit on failure, or
 * null when the caller is authorised. Mutations also require the CSRF header.
 */
export function requireAdmin(
  req: NextRequest,
  opts: { mutation?: boolean } = {},
): NextResponse | null {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  if (opts.mutation !== false && !hasCsrfHeader(req)) {
    return NextResponse.json({ error: 'Missing CSRF header' }, { status: 403 });
  }
  return null;
}
