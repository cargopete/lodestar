import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/studio/auth';
import { hasDbAccess } from '@/lib/db';
import { getBounty, updateBountyStatus } from '@/lib/studio/db';

// PATCH — cancel (developer) or claim (anyone with address)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await req.json().catch(() => null);
  const { action } = body ?? {};

  const bounty = await getBounty(numId);
  if (!bounty) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (bounty.status !== 'open') {
    return NextResponse.json({ error: `Bounty is already ${bounty.status}` }, { status: 409 });
  }

  if (action === 'cancel') {
    if (bounty.developer_address !== auth.address) {
      return NextResponse.json({ error: 'Only the developer can cancel their bounty' }, { status: 403 });
    }
    await updateBountyStatus(numId, 'cancelled');
    return NextResponse.json({ ok: true, status: 'cancelled' });
  }

  if (action === 'claim') {
    await updateBountyStatus(numId, 'claimed', auth.address);
    return NextResponse.json({ ok: true, status: 'claimed', claimedBy: auth.address });
  }

  return NextResponse.json({ error: 'action must be "cancel" or "claim"' }, { status: 400 });
}
