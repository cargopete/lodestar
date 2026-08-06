import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { runDisassembly } from '@/lib/disassembly';
import { diffReports } from '@/lib/disassembly/diff';
import { fetchDeploymentSignal } from '@/lib/disassembly/signal';
import { IPFS_HASH_RE } from '@/lib/disassembly/ipfs';
import { log } from '@/lib/logger';

// Deployments are immutable, so the underlying reports cache hard. We reuse the
// exact same cache keys as the single-report route so a report (and its signal)
// viewed there is reused here (and vice versa).
const TTL = 7 * 24 * 60 * 60; // 7 days
const SIGNAL_TTL = 300; // 5 min — curation signal is dynamic

function report(id: string) {
  return cached(`lodestar:disasm:v2:${id}`, TTL, () => runDisassembly(id));
}

function signal(id: string) {
  return cached(`lodestar:disasm-signal:${id}`, SIGNAL_TTL, () => fetchDeploymentSignal(id));
}

export async function GET(request: NextRequest) {
  const a = request.nextUrl.searchParams.get('a');
  const b = request.nextUrl.searchParams.get('b');

  if (!a || !b || !IPFS_HASH_RE.test(a) || !IPFS_HASH_RE.test(b)) {
    return NextResponse.json(
      { error: 'Provide two deployment IDs as ?a=Qm…&b=Qm… (CIDv0 hashes)' },
      { status: 400 },
    );
  }
  if (a === b) {
    return NextResponse.json(
      { error: 'Both deployment IDs are identical, so there is nothing to compare' },
      { status: 400 },
    );
  }

  try {
    const [baseReport, targetReport, sigA, sigB] = await Promise.all([
      report(a), report(b), signal(a), signal(b),
    ]);
    const base = { ...baseReport, signal: sigA };
    const target = { ...targetReport, signal: sigB };
    const diff = diffReports(base, target);
    return NextResponse.json(
      { data: { diff, base, target } },
      { headers: { 'Cache-Control': `public, s-maxage=${SIGNAL_TTL}, stale-while-revalidate=${TTL}` } },
    );
  } catch (error) {
    log.api.error({ err: error, a, b }, 'Subgraph disassembly diff error');
    const message = error instanceof Error ? error.message : 'Failed to compare subgraphs';
    const status = /manifest|deployment ID|WebAssembly|IPFS gateway/i.test(message) ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
