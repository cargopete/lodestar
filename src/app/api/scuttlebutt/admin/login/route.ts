import { type NextRequest, NextResponse } from 'next/server';
import {
  checkAdminPassword,
  isAdmin,
  setAdminCookie,
  clearAdminCookie,
} from '@/lib/scuttlebutt-admin';

export const runtime = 'nodejs';

// GET — am I logged in as admin?
export async function GET(req: NextRequest) {
  return NextResponse.json({ admin: isAdmin(req) });
}

// POST — log in with the admin password; sets a signed HttpOnly cookie.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!checkAdminPassword(password)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }
  const res = NextResponse.json({ admin: true });
  setAdminCookie(res);
  return res;
}

// DELETE — log out.
export async function DELETE() {
  const res = NextResponse.json({ admin: false });
  clearAdminCookie(res);
  return res;
}
