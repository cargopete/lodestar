import { type NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/scuttlebutt-admin';
import { SB_ROOM, HISTORY_LIMIT } from '@/lib/scuttlebutt';

export const runtime = 'nodejs';

// GET — moderation view: recent messages including ip_hash (so the admin can see
// which posters share an origin) and deleted rows. Admin-only.
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req, { mutation: false });
  if (denied) return denied;

  if (!db) {
    return NextResponse.json({ error: 'Scuttlebutt is unavailable' }, { status: 503 });
  }

  const sp = req.nextUrl.searchParams;
  const beforeRaw = sp.get('before');
  const before = beforeRaw && /^\d+$/.test(beforeRaw) ? parseInt(beforeRaw, 10) : null;

  try {
    const rows = before
      ? await db`
          SELECT id, room, name, tripcode, body, ip_hash, created_at, deleted
          FROM scuttlebutt_messages
          WHERE room = ${SB_ROOM} AND id < ${before}
          ORDER BY id DESC LIMIT ${HISTORY_LIMIT}`
      : await db`
          SELECT id, room, name, tripcode, body, ip_hash, created_at, deleted
          FROM scuttlebutt_messages
          WHERE room = ${SB_ROOM}
          ORDER BY id DESC LIMIT ${HISTORY_LIMIT}`;
    return NextResponse.json({ messages: rows });
  } catch {
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}
