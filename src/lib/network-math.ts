/**
 * Pure network/epoch math. No I/O — unit-tested.
 */

export type EpochStatus = 'Active' | 'Settling' | 'Distributing' | 'Finalized';

/**
 * Derive an epoch's lifecycle status from its number relative to the current
 * epoch. The network subgraph has no `status` field, so this is a derived
 * approximation matching Explorer's visual progression:
 *   current → Active, current-1 → Settling, current-2 → Distributing, older → Finalized.
 */
export function epochStatus(epochId: number, currentEpoch: number): EpochStatus {
  const age = currentEpoch - epochId;
  if (age <= 0) return 'Active';
  if (age === 1) return 'Settling';
  if (age === 2) return 'Distributing';
  return 'Finalized';
}

/**
 * Ethereum L1 blocks per year at the observed post-merge ~12.09s/block. The
 * Graph's rewards issuance is anchored to L1 block numbers.
 */
export const L1_BLOCKS_PER_YEAR = Math.round((365.25 * 24 * 3600) / 12.09);

/**
 * Annualised GRT issuance as a percentage of total supply.
 * `issuancePerBlockGrt` and `totalSupplyGrt` are in whole GRT (not wei).
 * Returns 0 for non-positive supply.
 */
export function annualIssuancePercent(
  issuancePerBlockGrt: number,
  totalSupplyGrt: number,
  blocksPerYear: number = L1_BLOCKS_PER_YEAR,
): number {
  if (totalSupplyGrt <= 0 || issuancePerBlockGrt < 0) return 0;
  return ((issuancePerBlockGrt * blocksPerYear) / totalSupplyGrt) * 100;
}
