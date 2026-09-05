// RFC-006 D5 — the persistence the D2 verdict has always said was "the caller's job" (lodestar#59).
//
// `assessServability` is the instantaneous read over one probe round. Rendering that read as
// "Effectively dead" meant one timed-out probe against a one-indexer deployment produced the
// scariest label on the page, cached for up to three minutes, and it did: uniswap-v4-base-3 on
// 2026-09-03. This module turns a short history of rounds into what may actually be rendered.
//
// Two rules, both pure:
//   - death needs persistence: K consecutive rounds with no serving operator (K >= 2, default 3);
//     recovery is instant, because a single serving round is proof of life;
//   - the gateway is the stronger witness: a round in which the gateway served an attested query
//     can never be dead, no matter what the direct probes saw, and it resets the streak. Direct
//     probes failing while the gateway serves usually means our egress, our SSRF guard or our probe
//     path is the problem, not the network.
//
// No IO. The store that feeds `history` lives in `servability-rounds.ts`; the route glues them.

/**
 * What the gateway said in a round. Persisted rounds carry it, so the type outlives the probe that
 * produced it: the gateway is no longer asked (nuthatch#1160), and new rounds record null.
 */
export type GatewayVerdict =
  | 'served' // gateway returned attested data
  | 'bad-indexers' // every tried indexer was rejected
  | 'no-indexers' // no indexers available to try
  | 'not-found' // deployment/subgraph unknown to the gateway
  | 'error'; // some other gateway error

/** Normalised reason bucket, for colour + copy. */
export type BadIndexerCategory = 'stale' | 'errored' | 'unavailable' | 'timeout' | 'other';

/** One probe round, as persisted. `gatewayVerdict` is null when no gateway probe ran. */
export interface RoundSummary {
  probedAt: string;
  servingOperators: number;
  servingIndexers: number;
  gatewayVerdict: GatewayVerdict | null;
}

export type RenderedState =
  | 'ok' // at least one operator served this round
  | 'rechecking' // dead this round, but not for K rounds yet: amber, non-terminal copy
  | 'conflicting' // dead by direct probes, served by the gateway in the same round: amber, log it
  | 'dead'; // K consecutive dead rounds, none of them served by the gateway

export interface RenderedServability {
  state: RenderedState;
  /** What the banner may say. True only for `state === 'dead'`. */
  effectivelyDead: boolean;
  /** Consecutive dead rounds ending at the newest, gateway-served rounds resetting it. */
  deadStreak: number;
  /** The threshold in force. */
  k: number;
  /** When the newest round was probed, so a cached verdict is visibly a snapshot. */
  probedAt: string | null;
}

export const DEFAULT_DEAD_ROUNDS = 3;

/** K from the environment, floored at 2: a first-ever dead round is never rendered dead. */
export function deadRoundsThreshold(raw = process.env.SERVABILITY_DEAD_ROUNDS): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n >= 2 ? n : DEFAULT_DEAD_ROUNDS;
}

const isDead = (r: RoundSummary) => r.servingOperators === 0;
const gatewayServed = (r: RoundSummary) => r.gatewayVerdict === 'served';

/**
 * @param history  rounds oldest to newest, the newest being the round just probed. An empty
 *                 history renders `ok` with nothing to say.
 * @param k        consecutive dead rounds before `dead`; anything below 2 is read as 2.
 */
export function applyPersistence(history: RoundSummary[], k = DEFAULT_DEAD_ROUNDS): RenderedServability {
  const threshold = Math.max(2, Math.floor(k));
  const current = history[history.length - 1];
  if (!current) {
    return { state: 'ok', effectivelyDead: false, deadStreak: 0, k: threshold, probedAt: null };
  }

  // Recovery is instant.
  if (!isDead(current)) {
    return { state: 'ok', effectivelyDead: false, deadStreak: 0, k: threshold, probedAt: current.probedAt };
  }

  // The gateway served a paid query this round: the deployment is not dead, whatever we saw.
  if (gatewayServed(current)) {
    return { state: 'conflicting', effectivelyDead: false, deadStreak: 0, k: threshold, probedAt: current.probedAt };
  }

  // Count back from the newest round: a serving round or a gateway-served round ends the streak.
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const r = history[i];
    if (!isDead(r) || gatewayServed(r)) break;
    streak += 1;
  }

  if (streak >= threshold) {
    return { state: 'dead', effectivelyDead: true, deadStreak: streak, k: threshold, probedAt: current.probedAt };
  }
  return { state: 'rechecking', effectivelyDead: false, deadStreak: streak, k: threshold, probedAt: current.probedAt };
}
