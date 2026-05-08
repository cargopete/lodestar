import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth, generateDeployKey, hashKey } from '@/lib/studio/auth';
import { hasDbAccess } from '@/lib/db';
import { getDeployKey, upsertDeployKey } from '@/lib/studio/db';

// GET — check whether a key exists (never returns the plaintext)
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const key = await getDeployKey(auth.address);
  return NextResponse.json({
    hasKey: key !== null,
    createdAt: key?.created_at ?? null,
    lastUsedAt: key?.last_used_at ?? null,
  });
}

// POST — generate (or regenerate) a deploy key, returns plaintext once
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const plaintext = generateDeployKey();
  await upsertDeployKey(auth.address, hashKey(plaintext));

  return NextResponse.json({ key: plaintext });
}
