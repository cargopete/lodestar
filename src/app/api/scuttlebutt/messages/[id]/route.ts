import { type NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publish } from '@/lib/cache';
import { requireAdmin } from '@/lib/scuttlebutt-admin';
import { SB_CHANNEL } from '@/lib/scuttlebutt';

export const runtime = 'nodejs';

// DELETE — admin soft-delete of a message. Broadcasts a delete event so open
// clients drop it live.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = requireAdmin(req, { mutation: true });
  if (denied) return denied;

  if (!db) {
    return NextResponse.json({ error: 'Scuttlebutt is unavailable' }, { status: 503 });
  }

  const { id: idRaw } = await params;
  if (!/^\d+$/.test(idRaw)) {
    return NextResponse.json({ error: 'Invalid message id' }, { status: 400 });
  }
  const id = parseInt(idRaw, 10);

  const reason = await req
    .json()
    .then((b) => (typeof b?.reason === 'string' ? b.reason.slice(0, 200) : null))
    .catch(() => null);

  try {
    const rows = await db`
      UPDATE scuttlebutt_messages
      SET deleted = true, deleted_at = now(), delete_reason = ${reason}
      WHERE id = ${id} AND deleted = false
      RETURNING id
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }
    await publish(SB_CHANNEL, JSON.stringify({ type: 'delete', id }));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
  }
}
