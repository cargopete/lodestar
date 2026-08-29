/**
 * Canonical global GRT supply, read on-chain.
 *
 * GRT is split across two live token contracts: the original GraphToken on
 * Ethereum L1 (genesis 10B + L1-era issuance) and the L2GraphToken on Arbitrum
 * One (the principal deployment since the L2 migration). The Arbitrum bridge is
 * lock-and-mint: tokens moved L1→L2 are *locked* in the L1 BridgeEscrow (still
 * counted in L1 `totalSupply`) and an equal amount is minted on L2. So naively
 * adding the two `totalSupply` figures double-counts everything sitting in the
 * escrow.
 *
 * The de-double-counted global supply is therefore:
 *
 *     global = L1.totalSupply + L2.totalSupply − escrow.balanceOf(L1 GRT)
 *
 * This matches the on-chain token supply Graph Explorer reports (~11.5B), and
 * is the correct denominator for the annualised issuance rate. Dividing by the
 * L2-only `totalSupply` (~3.6B) overstates the rate ~3× (the 8.6% confusion).
 */

import { fetchTotalSupply, fetchErc20Balance } from './erc20-supply';

// GraphToken on Ethereum mainnet — genesis 10B, verified 2020-12-14.
export const L1_GRAPH_TOKEN = '0xc944E90C64B2c07662A292be6244BDf05Cda44a7';
// L2GraphToken proxy on Arbitrum One — the canonical L2 deployment.
export const L2_GRAPH_TOKEN = '0x9623063377AD1B27544C965cCd7342f7EA7e88C7';
// L1 BridgeEscrow — locks the L1 GRT that backs every bridged L2 token.
export const L1_BRIDGE_ESCROW = '0x36aFF7001294daE4C2ED4fDEfC478a00De77F090';

export interface GrtSupplyBreakdown {
  /** L1 GraphToken.totalSupply() — includes escrow-locked tokens. */
  l1TotalSupply: number;
  /** L2GraphToken.totalSupply() — bridged-in (escrow-backed) + L2 issuance. */
  l2TotalSupply: number;
  /** GRT locked in the L1 BridgeEscrow, backing the L2 supply. */
  bridgeEscrow: number;
  /** De-double-counted global supply: L1 + L2 − escrow. */
  globalSupply: number;
}

/**
 * Combine the three on-chain reads into the de-double-counted global supply.
 * Pure — unit-tested. `escrow` is subtracted because those tokens are counted
 * in both `l1TotalSupply` (held by the escrow) and `l2TotalSupply` (minted on L2).
 */
export function computeGlobalSupply(
  l1TotalSupply: number,
  l2TotalSupply: number,
  bridgeEscrow: number
): number {
  return l1TotalSupply + l2TotalSupply - bridgeEscrow;
}

/**
 * Read L1 + L2 GRT supply and the bridge-escrow balance on-chain and return the
 * full breakdown. Returns `null` if any read fails so callers can fall back to a
 * static approximation rather than publish a wrong figure.
 */
export async function fetchGrtSupplyBreakdown(): Promise<GrtSupplyBreakdown | null> {
  const [l1, l2, escrow] = await Promise.all([
    fetchTotalSupply('mainnet', L1_GRAPH_TOKEN, 18),
    fetchTotalSupply('arbitrum', L2_GRAPH_TOKEN, 18),
    fetchErc20Balance('mainnet', L1_GRAPH_TOKEN, L1_BRIDGE_ESCROW, 18),
  ]);
  if (l1 == null || l2 == null || escrow == null) return null;
  return {
    l1TotalSupply: l1,
    l2TotalSupply: l2,
    bridgeEscrow: escrow,
    globalSupply: computeGlobalSupply(l1, l2, escrow),
  };
}
