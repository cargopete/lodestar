// Subgraph Disassembly — signal overlay (Phase 1.5b).
//
// A risk flag on a subgraph with 5 GRT signalled is trivia; the same flag with
// 400k GRT behind it is news. This module fetches a deployment's *current*
// curation signal and turns (worst flag severity × GRT at stake) into a single
// priority. It's a best-effort overlay — if the gateway is unreachable, signal
// is simply absent and the static analysis stands on its own.

import { hasNuthatch, nuthatchSql } from '@/lib/nuthatch';
import { deploymentSignalsSql, type NestDeploymentSignalRow } from '@/lib/nest-queries';
import { ipfsHashToBytes32 } from '@/lib/studio/ipfs';
import { weiToGRT } from '@/lib/utils';
import type { FlagLevel, SignalContext, SignalExposure } from './types';

const SIGNAL_FIRST = 100;

/** GRT-signalled → exposure bucket. Thresholds tuned to The Graph's signal distribution. */
export function signalExposure(signalledGRT: number): SignalExposure {
  if (signalledGRT <= 0) return 'none';
  if (signalledGRT < 1_000) return 'low';
  if (signalledGRT < 50_000) return 'medium';
  return 'high';
}

export type RiskPriority = 'low' | 'medium' | 'high' | 'critical';

const EXPOSURE_RANK: Record<SignalExposure, number> = { none: 0, low: 1, medium: 2, high: 3 };

/**
 * Combine the worst flag severity with how much GRT is signalled.
 * Clean code (no warn/critical flags) is always low priority — nothing is at
 * risk no matter how much GRT rides on it. A critical flag on a heavily
 * signalled deployment is the only thing that reaches `critical`.
 */
export function riskPriority(worst: FlagLevel | 'none', exposure: SignalExposure): RiskPriority {
  if (worst === 'none' || worst === 'info') return 'low';
  const e = EXPOSURE_RANK[exposure];
  if (worst === 'warn') {
    return e >= 3 ? 'high' : e === 2 ? 'medium' : 'low';
  }
  // worst === 'critical'
  return e >= 3 ? 'critical' : e === 2 ? 'high' : 'medium';
}

/** Highest-severity flag level present, or 'none'. */
export function worstFlagLevel(levels: FlagLevel[]): FlagLevel | 'none' {
  if (levels.includes('critical')) return 'critical';
  if (levels.includes('warn')) return 'warn';
  if (levels.includes('info')) return 'info';
  return 'none';
}

/**
 * Best-effort current curation signal for a deployment ID (Qm…). Returns null
 * when no gateway access is configured or the query fails — signal is an
 * overlay, never load-bearing.
 */
export async function fetchDeploymentSignal(deploymentId: string): Promise<SignalContext | null> {
  // From the nest, always (nuthatch#1160); the gateway path this once fell back to left with the key.
  if (!hasNuthatch()) return null;
  try {
    const id = ipfsHashToBytes32(deploymentId).toLowerCase();
    const rows = await nuthatchSql<NestDeploymentSignalRow>(deploymentSignalsSql(id, SIGNAL_FIRST), process.env.NUTHATCH_ALLOCATIONS_BASE_PATH || '/alloc');
    const d = rows[0];
    if (!d) return null;
    const signalledGRT = weiToGRT(d.deployment_signalled_tokens ?? '0');
    const queryFeesGRT = weiToGRT(d.deployment_query_fees_amount ?? '0');
    return {
      signalledTokens: d.deployment_signalled_tokens ?? '0', queryFeesAmount: d.deployment_query_fees_amount ?? '0',
      signalledGRT, queryFeesGRT, curatorCount: rows.length, curatorCountCapped: rows.length >= SIGNAL_FIRST, exposure: signalExposure(signalledGRT),
    };
  } catch {
    return null;
  }
}
