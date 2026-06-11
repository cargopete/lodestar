import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { runDisassembly } from '@/lib/disassembly';
import { fetchDeploymentSignal } from '@/lib/disassembly/signal';
import { IPFS_HASH_RE } from '@/lib/disassembly/ipfs';
import { log } from '@/lib/logger';

// The static analysis is immutable (content-addressed), so cache it hard.
const TTL = 7 * 24 * 60 * 60; // 7 days
// Curation signal is dynamic — cache briefly and keep the response s-maxage low
// so the overlay stays fresh while the heavy parse is served from the 7d cache.
const SIGNAL_TTL = 300; // 5 min

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');

  if (!id || !IPFS_HASH_RE.test(id)) {
    return NextResponse.json(
      { error: 'Invalid deployment ID. Expected a CIDv0 hash (Qm…)' },
      { status: 400 },
    );
  }

  try {
    const [report, signal] = await Promise.all([
      cached(`lodestar:disasm:v1:${id}`, TTL, () => runDisassembly(id)),
      cached(`lodestar:disasm-signal:${id}`, SIGNAL_TTL, () => fetchDeploymentSignal(id)),
    ]);
    return NextResponse.json({ data: { ...report, signal } }, {
      headers: { 'Cache-Control': `public, s-maxage=${SIGNAL_TTL}, stale-while-revalidate=${TTL}` },
    });
  } catch (error) {
    log.api.error({ err: error, id }, 'Subgraph disassembly error');
    const message = error instanceof Error ? error.message : 'Failed to disassemble subgraph';
    // Upstream/manifest problems are the user's input, not a server fault.
    const status = /manifest|deployment ID|WebAssembly|IPFS gateway/i.test(message) ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
