/**
 * Studio API key management (RFC-004 Phase A — free-tier only, NO billing).
 *
 * SIWE-gated console CRUD, mirroring the deploy-key route shape.
 *   GET  — list the caller's keys, each with this month's usage, plus the
 *          per-user monthly limit + remaining quota.
 *   POST — mint a new key { label? }; returns plaintext ONCE.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/studio/auth';
import { hasDbAccess } from '@/lib/db';
import { generateApiKey } from '@/lib/studio/api-keys';
import { createApiKey, getKeyUsage, getOwnerUsage, listApiKeys } from '@/lib/studio/db';

// Free-tier per-user monthly query cap (env-configurable).
const PER_USER = process.env.GATEWAY_FREE_TIER_PER_USER
  ? parseInt(process.env.GATEWAY_FREE_TIER_PER_USER, 10)
  : 5000;

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const period = currentPeriod();
  const keys = await listApiKeys(auth.address);

  const withUsage = await Promise.all(
    keys.map(async (k) => ({
      id: k.id,
      label: k.label,
      keyPrefix: k.key_prefix,
      status: k.status,
      createdAt: k.created_at,
      lastUsedAt: k.last_used_at,
      revokedAt: k.revoked_at,
      usageThisMonth: await getKeyUsage(k.id, period),
    })),
  );

  const ownerUsage = await getOwnerUsage(auth.address, period);

  return NextResponse.json({
    keys: withUsage,
    period,
    perUserLimit: PER_USER,
    usageThisMonth: ownerUsage,
    remaining: Math.max(0, PER_USER - ownerUsage),
  });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  let label: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.label === 'string' && body.label.trim()) {
      label = body.label.trim().slice(0, 120);
    }
  } catch {
    // empty / invalid body is fine — label is optional
  }

  const { plaintext, hash, prefix } = generateApiKey();
  const row = await createApiKey(auth.address, label, hash, prefix);

  // Plaintext returned ONCE — never stored, never shown again.
  return NextResponse.json({
    key: plaintext,
    id: row.id,
    label: row.label,
    keyPrefix: row.key_prefix,
    createdAt: row.created_at,
  });
}
