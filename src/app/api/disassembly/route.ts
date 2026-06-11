import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { runDisassembly } from '@/lib/disassembly';
import { IPFS_HASH_RE } from '@/lib/disassembly/ipfs';
import { log } from '@/lib/logger';

// A deployment is immutable (content-addressed), so cache hard.
const TTL = 7 * 24 * 60 * 60; // 7 days

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');

  if (!id || !IPFS_HASH_RE.test(id)) {
    return NextResponse.json(
      { error: 'Invalid deployment ID. Expected a CIDv0 hash (Qm…)' },
      { status: 400 },
    );
  }

  try {
    const report = await cached(`lodestar:disasm:v1:${id}`, TTL, () => runDisassembly(id));
    return NextResponse.json({ data: report }, {
      headers: { 'Cache-Control': `public, s-maxage=${TTL}, stale-while-revalidate=${TTL * 2}` },
    });
  } catch (error) {
    log.api.error({ err: error, id }, 'Subgraph disassembly error');
    const message = error instanceof Error ? error.message : 'Failed to disassemble subgraph';
    // Upstream/manifest problems are the user's input, not a server fault.
    const status = /manifest|deployment ID|WebAssembly|IPFS gateway/i.test(message) ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
