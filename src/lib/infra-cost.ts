/**
 * Per-chain archive-node infrastructure cost model for indexer P&L.
 *
 * These are MAINTAINED DEFAULT ESTIMATES, not gospel — archive-node cost varies
 * wildly by client, era, and provider (e.g. Arbitrum One archive is cited from
 * 3.27 TB PathDB up to ~38 TB depending on source, $760–3,800/mo storage alone).
 * The UI lets operators override any figure; never present these as authoritative.
 */

export interface ChainCost {
  key: string;
  label: string;
  /** Rough archive storage footprint, TB. Informational. */
  storageTb: number | null;
  /** Default fully-loaded monthly cost estimate, USD. */
  monthlyUsd: number;
}

// Representative defaults. Override per-operator from the UI.
export const DEFAULT_CHAIN_COSTS: Record<string, ChainCost> = {
  mainnet:   { key: 'mainnet',   label: 'Ethereum',     storageTb: 18,   monthlyUsd: 700 },
  arbitrum:  { key: 'arbitrum',  label: 'Arbitrum One', storageTb: 3.3,  monthlyUsd: 1500 },
  base:      { key: 'base',      label: 'Base',         storageTb: 6,    monthlyUsd: 800 },
  optimism:  { key: 'optimism',  label: 'Optimism',     storageTb: 4,    monthlyUsd: 500 },
  polygon:   { key: 'polygon',   label: 'Polygon',      storageTb: 12,   monthlyUsd: 1200 },
  gnosis:    { key: 'gnosis',    label: 'Gnosis',       storageTb: 2,    monthlyUsd: 300 },
  bsc:       { key: 'bsc',       label: 'BNB Chain',    storageTb: 15,   monthlyUsd: 1500 },
  avalanche: { key: 'avalanche', label: 'Avalanche',    storageTb: 5,    monthlyUsd: 600 },
  celo:      { key: 'celo',      label: 'Celo',         storageTb: 2,    monthlyUsd: 300 },
  fantom:    { key: 'fantom',    label: 'Fantom',       storageTb: 3,    monthlyUsd: 400 },
  scroll:    { key: 'scroll',    label: 'Scroll',       storageTb: 1,    monthlyUsd: 300 },
  linea:     { key: 'linea',     label: 'Linea',        storageTb: 1,    monthlyUsd: 300 },
};

/** A baseline operator overhead (graph-node, indexer-agent, monitoring, etc.), USD/mo. */
export const DEFAULT_BASE_OVERHEAD_USD = 300;

export interface CostModelInput {
  /** Chains the operator runs archive nodes for. */
  chains: string[];
  /** Per-chain monthly USD overrides, keyed by chain key. */
  overrides?: Record<string, number>;
  /** Operator overhead override, USD/mo. Defaults to DEFAULT_BASE_OVERHEAD_USD. */
  baseOverheadUsd?: number;
}

export interface CostLine {
  key: string;
  label: string;
  monthlyUsd: number;
  isOverride: boolean;
}

export interface CostModel {
  lines: CostLine[];
  baseOverheadUsd: number;
  totalMonthlyUsd: number;
}

/**
 * Resolve a cost model from a chain selection + overrides.
 * Unknown chain keys are included using their override (if given) or skipped.
 */
export function resolveCostModel(input: CostModelInput): CostModel {
  const overrides = input.overrides ?? {};
  const baseOverheadUsd = input.baseOverheadUsd ?? DEFAULT_BASE_OVERHEAD_USD;

  const lines: CostLine[] = [];
  for (const chain of input.chains) {
    const def = DEFAULT_CHAIN_COSTS[chain];
    const override = overrides[chain];
    if (override === undefined && !def) continue; // unknown chain, no override → skip
    lines.push({
      key: chain,
      label: def?.label ?? chain,
      monthlyUsd: override ?? def!.monthlyUsd,
      isOverride: override !== undefined,
    });
  }

  const totalMonthlyUsd =
    baseOverheadUsd + lines.reduce((s, l) => s + l.monthlyUsd, 0);

  return { lines, baseOverheadUsd, totalMonthlyUsd };
}
