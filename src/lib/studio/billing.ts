/**
 * Pure billing math for the metered gateway (RFC-004).
 *
 * No DB / Redis / RPC / Next imports — this module governs real money and is
 * exhaustively unit-tested, and it must be importable by the standalone VPS
 * proxy as well as Next API routes.
 *
 * Model: we charge a conservative `reserve` per query up front (so Lodestar
 * never fronts a short-term loss), then reconcile against the gateway's ACTUAL
 * fees and refund the excess — so users net-pay exactly cost, no spread.
 */

/** The Graph's published query price in USD ($2 / 100k). Recalibrated from real spend in Phase 4. */
export const TARGET_USD_PER_QUERY = 0.00002;

/** Conservative multiplier on the reserve rate; the buffer is refunded on reconciliation. */
export const RESERVE_BUFFER = 1.3;

/** Convert USD → GRT at a given GRT/USD price. */
export function usdToGrt(usd: number, grtPriceUsd: number): number {
  if (!(grtPriceUsd > 0)) throw new Error('grtPriceUsd must be > 0');
  if (usd < 0) throw new Error('usd must be >= 0');
  return usd / grtPriceUsd;
}

/** Convert GRT → USD at a given GRT/USD price. */
export function grtToUsd(grt: number, grtPriceUsd: number): number {
  if (grt < 0) throw new Error('grt must be >= 0');
  return grt * grtPriceUsd;
}

/** Per-query GRT amount to RESERVE — the buffered, conservative charge. */
export function reserveRateGrt(grtPriceUsd: number, buffer: number = RESERVE_BUFFER): number {
  if (!(buffer >= 1)) throw new Error('buffer must be >= 1 (no negative spread)');
  return usdToGrt(TARGET_USD_PER_QUERY, grtPriceUsd) * buffer;
}

/** Whether `balanceGrt` can cover a non-negative `costGrt`. */
export function canAfford(balanceGrt: number, costGrt: number): boolean {
  return costGrt >= 0 && balanceGrt >= costGrt;
}

/** New balance after debiting `costGrt`. Throws if it cannot be covered. */
export function debit(balanceGrt: number, costGrt: number): number {
  if (costGrt < 0) throw new Error('costGrt must be >= 0');
  if (costGrt > balanceGrt) throw new Error('insufficient balance');
  return balanceGrt - costGrt;
}

/**
 * True-up refund for one user after a reconciliation period.
 *
 * We debited `userQueries * reserveRateGrt` up front. The user's actual cost is
 * their pro-rata share of the gateway's real total fees for the proxy key. Refund
 * the difference. Never negative: if the reserve under-covered (rare, given the
 * buffer), Lodestar absorbs it rather than retroactively billing the user — the
 * free 100k/month tier therefore passes straight through to users.
 */
export function reconcileRefund(args: {
  reserveRateGrt: number;
  actualTotalFeesGrt: number;
  totalQueries: number;
  userQueries: number;
}): number {
  const { reserveRateGrt: rate, actualTotalFeesGrt, totalQueries, userQueries } = args;
  if (userQueries <= 0 || totalQueries <= 0) return 0;
  if (rate < 0 || actualTotalFeesGrt < 0) throw new Error('rate and fees must be >= 0');
  const reserved = userQueries * rate;
  const actualOwed = (userQueries / totalQueries) * actualTotalFeesGrt;
  const refund = reserved - actualOwed;
  return refund > 0 ? refund : 0;
}
