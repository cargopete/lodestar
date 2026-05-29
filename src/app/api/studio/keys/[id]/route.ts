/**
 * Revoke a Studio API key (RFC-004 Phase A — free-tier only, NO billing).
 *
 * DELETE /api/studio/keys/[id] — owner-scoped soft-revoke (status='revoked').
 */
import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/studio/auth';
import { hasDbAccess } from '@/lib/db';
import { revokeApiKey } from '@/lib/studio/db';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  await revokeApiKey(numId, auth.address);
  return NextResponse.json({ ok: true });
}
