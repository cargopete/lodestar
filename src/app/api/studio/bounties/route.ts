import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSessionAddress } from '@/lib/studio/auth';
import { hasDbAccess } from '@/lib/db';
import { listBounties, createBounty, getSubgraphBySlug } from '@/lib/studio/db';

// GET — public list of open bounties, or filter by ?deployment=Qm...
export async function GET(req: NextRequest) {
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const deploymentId = req.nextUrl.searchParams.get('deployment') ?? undefined;
  const bounties = await listBounties(deploymentId);
  return NextResponse.json({ bounties });
}

// POST — create a bounty (requires auth)
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const body = await req.json().catch(() => null);
  const { deployment_id, slug, amount_grt, message, expires_at, chain_bounty_id, post_tx_hash } = body ?? {};

  if (!deployment_id || !amount_grt) {
    return NextResponse.json({ error: 'deployment_id and amount_grt are required' }, { status: 400 });
  }

  const amount = parseFloat(amount_grt);
  if (isNaN(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount_grt must be a positive number' }, { status: 400 });
  }

  let subgraphId: number | null = null;
  if (slug) {
    const sg = await getSubgraphBySlug(slug);
    if (sg && sg.owner_address === auth.address) subgraphId = sg.id;
  }

  const bounty = await createBounty({
    deployment_id,
    subgraph_id: subgraphId,
    developer_address: auth.address,
    amount_grt: String(amount),
    message: message ?? null,
    expires_at: expires_at ?? null,
    chain_bounty_id: chain_bounty_id ? String(chain_bounty_id) : null,
    post_tx_hash: post_tx_hash ?? null,
  });

  return NextResponse.json({ bounty }, { status: 201 });
}
