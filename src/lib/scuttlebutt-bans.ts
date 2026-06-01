import { db } from '@/lib/db';

/**
 * Ban storage for Scuttlebutt. Postgres-backed, indexed on ip_hash and tripcode.
 *
 * A single indexed lookup per post is cheap, so bans are checked straight
 * against the DB (no Redis cache yet — add one if post volume ever makes it hurt).
 */

export interface Ban {
  id: number;
  ip_hash: string | null;
  tripcode: string | null;
  reason: string | null;
  created_at: string;
  expires_at: string | null;
}

/** True if the given ip_hash or tripcode has an active (non-expired) ban. */
export async function isBanned(
  ipHash: string,
  tripcode: string | null,
): Promise<boolean> {
  if (!db) return false;
  const target = tripcode
    ? db`ip_hash = ${ipHash} OR tripcode = ${tripcode}`
    : db`ip_hash = ${ipHash}`;
  const rows = await db`
    SELECT 1 FROM scuttlebutt_bans
    WHERE (expires_at IS NULL OR expires_at > now())
      AND (${target})
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function addBan(input: {
  ipHash?: string | null;
  tripcode?: string | null;
  reason?: string | null;
  expiresAt?: string | null;
}): Promise<Ban | null> {
  if (!db) return null;
  const rows = await db`
    INSERT INTO scuttlebutt_bans (ip_hash, tripcode, reason, expires_at)
    VALUES (${input.ipHash ?? null}, ${input.tripcode ?? null}, ${input.reason ?? null}, ${input.expiresAt ?? null})
    RETURNING id, ip_hash, tripcode, reason, created_at, expires_at
  `;
  return (rows[0] as Ban) ?? null;
}

export async function removeBan(id: number): Promise<void> {
  if (!db) return;
  await db`DELETE FROM scuttlebutt_bans WHERE id = ${id}`;
}

/** All currently-active bans, newest first. */
export async function listBans(): Promise<Ban[]> {
  if (!db) return [];
  const rows = await db`
    SELECT id, ip_hash, tripcode, reason, created_at, expires_at
    FROM scuttlebutt_bans
    WHERE expires_at IS NULL OR expires_at > now()
    ORDER BY id DESC
  `;
  return rows as unknown as Ban[];
}
