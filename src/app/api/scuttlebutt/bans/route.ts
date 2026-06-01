import { type NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/scuttlebutt-admin';
import { addBan, removeBan, listBans } from '@/lib/scuttlebutt-bans';

export const runtime = 'nodejs';

// GET — list active bans (admin).
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req, { mutation: false });
  if (denied) return denied;
  return NextResponse.json({ bans: await listBans() });
}

// POST — add a ban by ip_hash and/or tripcode (admin).
export async function POST(req: NextRequest) {
  const denied = requireAdmin(req, { mutation: true });
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const ipHash = typeof body?.ipHash === 'string' ? body.ipHash : null;
  const tripcode = typeof body?.tripcode === 'string' ? body.tripcode : null;
  if (!ipHash && !tripcode) {
    return NextResponse.json(
      { error: 'Provide an ipHash and/or tripcode to ban' },
      { status: 400 },
    );
  }
  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 200) : null;
  const expiresAt = typeof body?.expiresAt === 'string' ? body.expiresAt : null;

  const ban = await addBan({ ipHash, tripcode, reason, expiresAt });
  return NextResponse.json({ ban });
}

// DELETE — lift a ban by id (admin).
export async function DELETE(req: NextRequest) {
  const denied = requireAdmin(req, { mutation: true });
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === 'number' ? body.id : null;
  if (id === null) {
    return NextResponse.json({ error: 'A ban id is required' }, { status: 400 });
  }
  await removeBan(id);
  return NextResponse.json({ ok: true });
}
