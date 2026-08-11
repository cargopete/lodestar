/**
 * Chain liveness — is this chain still producing blocks at all?
 *
 * Every staleness signal in the stack measures distance to chain head:
 * `blocksBehind`, `syncProgress`, graph-node's `synced` flag, and our own
 * reconcileToNetworkHead. All of them are relative. When a chain STOPS, the
 * head freezes, the distance to it goes to zero, and every one of those signals
 * reports perfect health — correctly, and to entirely the wrong conclusion.
 *
 * A subgraph on a halted chain is at chain head, has no indexing errors, is
 * attested by its indexers and renders green in every dashboard including this
 * one. It will serve the same answer forever. Moonbeam stopped producing blocks
 * around 2026-08-10 and every subgraph on it entered exactly that state; two
 * Celo subgraphs sat behind an indexer reporting itself 99.98% synced against a
 * head that had not moved in 85 hours.
 *
 * The only signal that survives is absolute rather than relative: has the head
 * we observe actually changed over wall-clock time. That is what this module
 * tracks. It is deliberately pure — the cron owns the IO and the cache.
 *
 * See nightswatchhq/graph-support#15.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * What we remember about one chain between cron runs.
 *
 * `head` is the highest block height we have ever observed for this chain,
 * across every indexer sampled. It never moves backwards: an indexer whose own
 * RPC has stalled cannot drag the recorded head down, which is the same
 * principle reconcileToNetworkHead uses within a single deployment.
 */
export interface ChainHeadRecord {
  /** Highest block height observed for this chain, across all sampled indexers. */
  head: number;
  /** When `head` first reached this value. The clock that stall is measured on. */
  headFirstSeenAt: number;
  /** When we last got a reading for this chain at all. */
  lastCheckedAt: number;
}

/**
 *  - live     — the head advanced within the observation window
 *  - stalled  — the head has not moved for a while. Could be the chain, could be
 *               every indexer serving it. From here those are indistinguishable,
 *               and for a consumer of the data they have the same consequence.
 *  - halted   — the head has not moved for long enough that a transient cause is
 *               no longer plausible
 *  - unknown  — we have no record, or our own sampling has lapsed. Never claim a
 *               chain is stalled on the strength of having stopped looking at it.
 */
export type ChainLiveness = 'live' | 'stalled' | 'halted' | 'unknown';

export interface LivenessVerdict {
  liveness: ChainLiveness;
  /** Head we last observed, or null when there is no record. */
  head: number | null;
  /**
   * How long we WATCHED the head fail to advance. Measured between
   * headFirstSeenAt and lastCheckedAt, never against `now` — we can only assert
   * non-advancement across the window we actually observed.
   */
  stalledForMs: number;
  /** Age of our own last reading. Large values are why a verdict can be 'unknown'. */
  observationAgeMs: number;
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * The chain-health cron samples every 30 minutes, so a perfectly live chain can
 * show up to ~30 minutes of apparent stall purely from the sampling interval.
 * These leave generous headroom above that: three missed advances before we say
 * anything, and twelve before we call it halted. The failures worth catching
 * were 22 hours and 85 hours, so precision costs us nothing and false alarms
 * would cost the signal its credibility.
 */
export const STALL_AFTER_MS = 90 * 60 * 1000;
export const HALT_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * If our newest reading is older than this, the cron has not run (deploy,
 * outage, cache eviction) and we know nothing current. Four sampling intervals.
 */
export const OBSERVATION_MAX_AGE_MS = 2 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure state transition
// ---------------------------------------------------------------------------

/**
 * Fold one observation into the record for a chain.
 *
 * Only a STRICTLY higher head restarts the clock. Re-observing the same head,
 * or a lower one from a lagging indexer, leaves `headFirstSeenAt` where it is,
 * which is what accumulates the stall.
 *
 * Known weakness, deliberately accepted for now: `head` is the maximum across
 * indexers, so a single node reporting a bogus future height would pin the head
 * above reality and the chain would then read as stalled until the real head
 * caught up. That is a false alarm rather than a false all-clear, which is the
 * direction we want to fail in, and the thresholds are wide enough that it
 * would take an extreme outlier to trigger.
 */
export function advanceChainHead(
  prev: ChainHeadRecord | null | undefined,
  observedHead: number,
  now: number,
): ChainHeadRecord {
  if (!Number.isFinite(observedHead) || observedHead <= 0) {
    // Not a usable reading. Preserve the record untouched rather than recording
    // a check we cannot stand behind.
    return prev ?? { head: 0, headFirstSeenAt: now, lastCheckedAt: now };
  }
  if (!prev || observedHead > prev.head) {
    return { head: observedHead, headFirstSeenAt: now, lastCheckedAt: now };
  }
  return { ...prev, lastCheckedAt: now };
}

// ---------------------------------------------------------------------------
// Pure classifier
// ---------------------------------------------------------------------------

/**
 * Decide liveness from a record. Split from the IO so the decision is
 * exhaustively testable without a cache, a clock or a network.
 */
export function classifyLiveness(
  record: ChainHeadRecord | null | undefined,
  now: number,
  thresholds: { stallAfterMs?: number; haltAfterMs?: number; maxObservationAgeMs?: number } = {},
): LivenessVerdict {
  const stallAfterMs = thresholds.stallAfterMs ?? STALL_AFTER_MS;
  const haltAfterMs = thresholds.haltAfterMs ?? HALT_AFTER_MS;
  const maxObservationAgeMs = thresholds.maxObservationAgeMs ?? OBSERVATION_MAX_AGE_MS;

  if (!record || record.head <= 0) {
    return { liveness: 'unknown', head: null, stalledForMs: 0, observationAgeMs: 0 };
  }

  const observationAgeMs = Math.max(now - record.lastCheckedAt, 0);
  const stalledForMs = Math.max(record.lastCheckedAt - record.headFirstSeenAt, 0);

  // We stopped watching. Say so, rather than reporting whatever the last frame
  // happened to show — the entire point of this module is not mistaking absent
  // information for a healthy reading.
  if (observationAgeMs > maxObservationAgeMs) {
    return { liveness: 'unknown', head: record.head, stalledForMs, observationAgeMs };
  }

  let liveness: ChainLiveness = 'live';
  if (stalledForMs >= haltAfterMs) liveness = 'halted';
  else if (stalledForMs >= stallAfterMs) liveness = 'stalled';

  return { liveness, head: record.head, stalledForMs, observationAgeMs };
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/** "85h", "3d 4h", "45m" — compact enough for a table cell. */
export function formatStallDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/**
 * One sentence a user can act on. Deliberately does not assert WHY the head
 * stopped: from our vantage a halted chain and a chain whose every indexer has
 * stalled look identical, and claiming to know which would be a guess.
 */
export function livenessMessage(verdict: LivenessVerdict, network: string): string | null {
  const { liveness, head, stalledForMs } = verdict;
  const dur = formatStallDuration(stalledForMs);
  switch (liveness) {
    case 'halted':
      return `${network} has not produced a new block in ${dur}. Subgraphs on it are frozen at block ${head?.toLocaleString()}, not broken: they will keep answering queries with data from that block indefinitely. Historical queries remain correct.`;
    case 'stalled':
      return `${network} head has not advanced in ${dur} (block ${head?.toLocaleString()}). Either the chain has stopped or every indexer we sample has. Treat "synced" on this chain as unverified.`;
    case 'unknown':
      return `No current liveness reading for ${network}.`;
    default:
      return null;
  }
}
