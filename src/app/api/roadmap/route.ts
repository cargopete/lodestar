import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ROADMAP_ITEMS, type CommunityStatus } from '@/lib/roadmap-data';
import { cached } from '@/lib/cache';

export interface CommunityUpdate {
  status: CommunityStatus;
  note: string | null;
  submitted_by: string | null;
  created_at: string;
}

export interface RoadmapItemWithCommunity {
  id: string;
  latestCommunity: CommunityUpdate | null;
  recentUpdates: CommunityUpdate[];
}

export async function GET() {
  try {
    const community = await cached('lodestar:roadmap:community', 60, async () => {
      if (!db) return {};

      // Ensure table exists (idempotent)
      await db`
        CREATE TABLE IF NOT EXISTS roadmap_community_updates (
          id           SERIAL PRIMARY KEY,
          item_id      TEXT NOT NULL,
          status       TEXT NOT NULL CHECK (status IN ('on_track', 'delayed', 'shipped', 'uncertain')),
          note         TEXT,
          submitted_by TEXT,
          created_at   TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await db`
        CREATE INDEX IF NOT EXISTS idx_roadmap_updates_item_id
        ON roadmap_community_updates (item_id, created_at DESC)
      `;

      // Fetch last 3 updates per item
      const rows = await db`
        SELECT DISTINCT ON (item_id)
          item_id, status, note, submitted_by, created_at
        FROM roadmap_community_updates
        ORDER BY item_id, created_at DESC
      ` as unknown as Array<{
        item_id: string;
        status: CommunityStatus;
        note: string | null;
        submitted_by: string | null;
        created_at: string;
      }>;

      const map: Record<string, CommunityUpdate> = {};
      for (const row of rows) {
        map[row.item_id] = {
          status: row.status,
          note: row.note,
          submitted_by: row.submitted_by,
          created_at: row.created_at,
        };
      }
      return map;
    });

    const items = ROADMAP_ITEMS.map((item) => ({
      ...item,
      communityStatus: (community as Record<string, CommunityUpdate>)[item.id] ?? null,
    }));

    return NextResponse.json({ items }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    });
  } catch (err) {
    console.error('Roadmap API error:', err);
    // Still return static items even if DB is down
    const items = ROADMAP_ITEMS.map((item) => ({ ...item, communityStatus: null }));
    return NextResponse.json({ items });
  }
}
