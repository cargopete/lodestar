import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ROADMAP_ITEMS, type CommunityStatus } from '@/lib/roadmap-data';

const VALID_STATUSES: CommunityStatus[] = ['on_track', 'delayed', 'shipped', 'uncertain'];
const VALID_ITEM_IDS = new Set(ROADMAP_ITEMS.map((i) => i.id));

export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  let body: { itemId: string; status: CommunityStatus; note?: string; submittedBy?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { itemId, status, note, submittedBy } = body;

  if (!itemId || !VALID_ITEM_IDS.has(itemId)) {
    return NextResponse.json({ error: 'Invalid item ID' }, { status: 400 });
  }
  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `Status must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
  }

  const noteTrimmed = note?.trim().slice(0, 500) || null;
  const submittedByTrimmed = submittedBy?.trim().slice(0, 100) || null;

  // Rate limit: max 3 submissions per item per hour (checked in DB — no Redis needed)
  const recentCount = await db`
    SELECT COUNT(*) as cnt
    FROM roadmap_community_updates
    WHERE item_id = ${itemId}
      AND created_at > NOW() - INTERVAL '1 hour'
  `;
  if (parseInt(recentCount[0].cnt as string) >= 10) {
    return NextResponse.json({ error: 'Too many updates for this item recently. Try again later.' }, { status: 429 });
  }

  await db`
    INSERT INTO roadmap_community_updates (item_id, status, note, submitted_by)
    VALUES (${itemId}, ${status}, ${noteTrimmed}, ${submittedByTrimmed})
  `;

  return NextResponse.json({ success: true });
}
