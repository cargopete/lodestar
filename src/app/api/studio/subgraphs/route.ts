import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/studio/auth';
import { hasDbAccess } from '@/lib/db';
import { listSubgraphs, createSubgraph, getSubgraphBySlug } from '@/lib/studio/db';

const SLUG_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;

// GET — list authenticated developer's subgraphs
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const subgraphs = await listSubgraphs(auth.address);
  return NextResponse.json({ subgraphs });
}

// POST — register a new subgraph slug
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const body = await req.json().catch(() => null);
  const { slug, displayName } = body ?? {};

  if (!slug || !SLUG_RE.test(slug)) {
    return NextResponse.json(
      { error: 'slug must be "org/name" using lowercase letters, numbers, and hyphens' },
      { status: 400 },
    );
  }

  const existing = await getSubgraphBySlug(slug);
  if (existing) {
    return NextResponse.json({ error: 'Slug already taken' }, { status: 409 });
  }

  const subgraph = await createSubgraph(auth.address, slug, displayName ?? null);
  return NextResponse.json({ subgraph }, { status: 201 });
}
