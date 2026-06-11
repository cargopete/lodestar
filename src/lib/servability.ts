// Per-deployment servability verdict (RFC-006 D2).
//
// Turns per-indexer live-serving probes (D1) into a deployment-level answer to
// the only question that matters: can *anyone* actually serve a paid query here
// right now? The verdict is keyed on SERVICE ALONE — clustering never decides
// "dead" (RFC-006 §0/§1). An optional operator grouping only refines the
// distinct-operator count and the single-point-of-failure (fragility) share.
//
// Pure and deterministic — no IO. Persistence ("N consecutive broken before we
// call it dead") is the caller's job (RFC-006 D2/D5); this is the instantaneous
// read over a given probe set.

export interface ServabilityInput {
  indexerId: string;
  /** D1: serveProbe === 'alive_paid' */
  servable: boolean;
  status: 'synced' | 'syncing' | 'failed' | 'unreachable';
  /** allocated stake, wei (decimal string) */
  allocatedTokens: string;
}

export interface ServabilityVerdict {
  /** distinct operators with at least one servable indexer */
  effectiveServingOperators: number;
  /** count of individual servable indexers */
  servingIndexerCount: number;
  /** no operator can serve — queries will fail despite any reported sync */
  effectivelyDead: boolean;
  /** dead now, but a rescue (a syncing indexer) is catching up */
  recovering: boolean;
  /**
   * Largest single operator's share of allocated stake (0–1). Surfaced ONLY as
   * a fragility / single-point-of-failure warning — NEVER as `dead`.
   */
  dominantOperatorShare: number;
}

function toBig(wei: string): bigint {
  try {
    return BigInt(wei.split('.')[0] || '0');
  } catch {
    return 0n;
  }
}

/**
 * @param indexers   per-indexer serving + sync + stake
 * @param operatorOf optional map indexerId → operator key (collapses one
 *                   operator's many identities). Defaults to identity, i.e.
 *                   each indexer is its own operator.
 */
export function assessServability(
  indexers: ServabilityInput[],
  operatorOf?: (indexerId: string) => string,
): ServabilityVerdict {
  const opKey = operatorOf ?? ((id: string) => id);

  const serving = indexers.filter((i) => i.servable);
  const servingOperators = new Set(serving.map((i) => opKey(i.indexerId)));
  const effectivelyDead = servingOperators.size === 0;

  // Fragility: stake concentrated in one operator means the gateway sees N
  // indexers of headroom but the deployment shares one fate.
  const stakeByOperator = new Map<string, bigint>();
  let totalStake = 0n;
  for (const i of indexers) {
    const k = opKey(i.indexerId);
    const s = toBig(i.allocatedTokens);
    stakeByOperator.set(k, (stakeByOperator.get(k) ?? 0n) + s);
    totalStake += s;
  }
  let maxStake = 0n;
  for (const s of stakeByOperator.values()) if (s > maxStake) maxStake = s;
  const dominantOperatorShare = totalStake > 0n ? Number((maxStake * 10000n) / totalStake) / 10000 : 0;

  return {
    effectiveServingOperators: servingOperators.size,
    servingIndexerCount: serving.length,
    effectivelyDead,
    recovering: effectivelyDead && indexers.some((i) => i.status === 'syncing'),
    dominantOperatorShare,
  };
}
