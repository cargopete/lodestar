// Subgraph Disassembly — shared loader for the canonical /disassembly/[id] route
// (Phase 1.5c). Used by both generateMetadata and the OpenGraph image so a shared
// report link unfurls with the right grade/risk/signal. Swallows errors and
// returns null — share surfaces must never throw.

import { cached } from '@/lib/cache';
import { runDisassembly } from '.';
import { fetchDeploymentSignal } from './signal';
import { IPFS_HASH_RE } from './ipfs';
import type { DisassemblyReport, SignalContext } from './types';

const TTL = 7 * 24 * 60 * 60; // 7 days — immutable static analysis
const SIGNAL_TTL = 300; // 5 min — dynamic signal

export interface ShareData {
  report: DisassemblyReport;
  signal: SignalContext | null;
}

/** Best-effort report + signal for share surfaces. Returns null on bad id / failure. */
export async function loadShareReport(id: string): Promise<ShareData | null> {
  if (!IPFS_HASH_RE.test(id)) return null;
  try {
    const [report, signal] = await Promise.all([
      cached(`lodestar:disasm:v2:${id}`, TTL, () => runDisassembly(id)),
      cached(`lodestar:disasm-signal:${id}`, SIGNAL_TTL, () => fetchDeploymentSignal(id)),
    ]);
    return { report, signal };
  } catch {
    return null;
  }
}
