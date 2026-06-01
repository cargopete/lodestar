import { type NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publish } from '@/lib/cache';
import { parseName } from '@/lib/scuttlebutt-trip';
import { clientIp, hashIp } from '@/lib/scuttlebutt-ip';
import { clean } from '@/lib/scuttlebutt-profanity';
import { isBanned } from '@/lib/scuttlebutt-bans';
import {
  SB_ROOM,
  SB_CHANNEL,
  MAX_BODY,
  HISTORY_LIMIT,
  floodCheck,
  type SbMessage,
} from '@/lib/scuttlebutt';

export const runtime = 'nodejs';

// GET — message history, newest-first. `?before=<id>` for scrollback, `?limit=`.
export async function GET(req: NextRequest) {
  if (!db) {
    return NextResponse.json({ error: 'Scuttlebutt is unavailable' }, { status: 503 });
  }
  const sp = req.nextUrl.searchParams;
  const beforeRaw = sp.get('before');
  const before = beforeRaw && /^\d+$/.test(beforeRaw) ? parseInt(beforeRaw, 10) : null;
  const limitRaw = sp.get('limit');
  const limit = limitRaw && /^\d+$/.test(limitRaw)
    ? Math.min(parseInt(limitRaw, 10), 100)
    : HISTORY_LIMIT;

  try {
    const rows = before
      ? await db`
          SELECT id, room, name, tripcode, body, created_at
          FROM scuttlebutt_messages
          WHERE room = ${SB_ROOM} AND deleted = false AND id < ${before}
          ORDER BY id DESC LIMIT ${limit}`
      : await db`
          SELECT id, room, name, tripcode, body, created_at
          FROM scuttlebutt_messages
          WHERE room = ${SB_ROOM} AND deleted = false
          ORDER BY id DESC LIMIT ${limit}`;
    return NextResponse.json({ messages: rows });
  } catch {
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}

// POST — submit a message. Anonymous; optional `Name#secret` tripcode.
export async function POST(req: NextRequest) {
  if (!db) {
    return NextResponse.json({ error: 'Scuttlebutt is unavailable' }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.body !== 'string') {
    return NextResponse.json({ error: 'A message body is required' }, { status: 400 });
  }

  const { name, tripcode } = parseName(typeof body.name === 'string' ? body.name : null);
  const { ok, filtered } = clean(body.body);
  if (!ok) {
    return NextResponse.json({ error: 'Message is empty' }, { status: 400 });
  }
  if (filtered.length > MAX_BODY) {
    return NextResponse.json(
      { error: `Message too long (max ${MAX_BODY} characters)` },
      { status: 400 },
    );
  }

  const ipHash = hashIp(clientIp(req));

  if (await isBanned(ipHash, tripcode)) {
    return NextResponse.json({ error: 'You are banned from Scuttlebutt' }, { status: 403 });
  }

  const flood = await floodCheck(ipHash);
  if (!flood.ok) {
    return NextResponse.json({ error: flood.reason }, { status: 429 });
  }

  try {
    const rows = await db`
      INSERT INTO scuttlebutt_messages (room, name, tripcode, body, ip_hash)
      VALUES (${SB_ROOM}, ${name}, ${tripcode}, ${filtered}, ${ipHash})
      RETURNING id, room, name, tripcode, body, created_at
    `;
    const message = rows[0] as unknown as SbMessage;
    await publish(SB_CHANNEL, JSON.stringify({ type: 'message', message }));
    return NextResponse.json({ message });
  } catch {
    return NextResponse.json({ error: 'Failed to post message' }, { status: 500 });
  }
}
