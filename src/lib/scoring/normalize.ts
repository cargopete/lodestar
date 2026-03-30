/**
 * Percentile-based normalization for leaderboard scoring.
 *
 * Values at or below p10 → 0, at or above p90 → maxPoints,
 * linear interpolation in between. Clamped to [0, maxPoints].
 */

/**
 * Compute a percentile value from a sorted array.
 * Uses linear interpolation between nearest ranks.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const frac = idx - lower;

  if (lower === upper) return sorted[lower];
  return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}

/**
 * Compute p10 and p90 boundaries from an array of values.
 */
export function computeBounds(values: number[]): { p10: number; p90: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p10: percentile(sorted, 10),
    p90: percentile(sorted, 90),
  };
}

/**
 * Normalize a value to [0, maxPoints] using p10/p90 bounds.
 * Values at p10 or below → 0. Values at p90 or above → maxPoints.
 */
export function normalize(
  value: number,
  p10: number,
  p90: number,
  maxPoints: number
): number {
  if (p90 <= p10) return value >= p10 ? maxPoints : 0;
  const clamped = Math.max(p10, Math.min(p90, value));
  return ((clamped - p10) / (p90 - p10)) * maxPoints;
}

/**
 * Like normalize, but does not cap at maxPoints.
 * Values above p90 continue to increase linearly.
 * Used for final score calculation to break ties among top indexers.
 */
export function normalizeUncapped(
  value: number,
  p10: number,
  p90: number,
  maxPoints: number
): number {
  if (p90 <= p10) return value >= p10 ? maxPoints : 0;
  const bounded = Math.max(p10, value);
  return ((bounded - p10) / (p90 - p10)) * maxPoints;
}

/**
 * Inverted normalization — lower values score higher.
 * Values at p10 (lowest) → maxPoints. Values at p90 (highest) → 0.
 */
export function normalizeInverted(
  value: number,
  p10: number,
  p90: number,
  maxPoints: number
): number {
  return maxPoints - normalize(value, p10, p90, maxPoints);
}
