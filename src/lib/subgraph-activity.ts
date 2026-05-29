import { weiToGRT } from './utils';

/**
 * Pure assembly of a subgraph's activity timeline from the two timestamped
 * sources the network subgraph exposes: version publishes and curator signals.
 * Merged reverse-chronologically and capped. Unit-tested.
 */
export type ActivityEvent =
  | { kind: 'version'; ts: number; label: string; version: number; ipfsHash: string }
  | { kind: 'signal'; ts: number; curator: string; signalledGrt: number };

export interface ActivityVersionInput {
  version: number;
  label: string | null;
  createdAt: number;
  ipfsHash: string;
}
export interface ActivitySignalInput {
  curatorAddress: string;
  lastSignalChange: number;
  signalledTokens: string;
}

export function buildActivityFeed(
  versions: ActivityVersionInput[],
  signals: ActivitySignalInput[],
  limit = 50,
): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (const v of versions) {
    out.push({ kind: 'version', ts: v.createdAt, label: v.label || `v${v.version}`, version: v.version, ipfsHash: v.ipfsHash });
  }
  for (const s of signals) {
    if (s.lastSignalChange > 0) {
      out.push({ kind: 'signal', ts: s.lastSignalChange, curator: s.curatorAddress, signalledGrt: weiToGRT(s.signalledTokens) });
    }
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, limit);
}
