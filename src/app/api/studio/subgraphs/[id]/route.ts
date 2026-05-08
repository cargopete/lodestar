import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/studio/auth';
import { hasDbAccess } from '@/lib/db';
import { deleteSubgraph, updateSubgraphMeta, setPublishedSubgraphId, updateVersionLabel } from '@/lib/studio/db';

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

  const body = await req.json().catch(() => ({}));

  if ('published_subgraph_id' in body) {
    await setPublishedSubgraphId(numId, auth.address, body.published_subgraph_id, body.version_label ?? null);
  } else if ('version_label' in body) {
    await updateVersionLabel(numId, auth.address, body.version_label ?? null);
  } else {
    await updateSubgraphMeta(numId, auth.address, body.display_name ?? null, body.description ?? null);
  }

  return NextResponse.json({ ok: true });
}

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

  await deleteSubgraph(numId, auth.address);
  return NextResponse.json({ ok: true });
}
