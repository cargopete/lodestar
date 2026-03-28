import { parse as parseYAML } from 'yaml';

// ---------- types ----------

export type ComplexityCategory = 'Light' | 'Moderate' | 'Heavy' | 'Extreme';

export interface ScoreBreakdown {
  dimension: string;
  rawValue: string;
  score: number;
  maxScore: number;
}

export interface DataSourceSignal {
  name: string;
  kind: string;
  network: string;
  address: string | null;
  startBlock: number;
  eventHandlers: number;
  callHandlers: number;
  blockHandlers: number;
}

export interface TemplateSignal {
  name: string;
  kind: string;
  network: string;
  eventHandlers: number;
  callHandlers: number;
  blockHandlers: number;
}

export interface ManifestAnalysis {
  score: number;
  category: ComplexityCategory;
  breakdown: ScoreBreakdown[];
  dataSources: DataSourceSignal[];
  templates: TemplateSignal[];
  features: string[];
  specVersion: string;
  network: string;
  graft: { base: string; block: number } | null;
  pruning: string | null;
}

// ---------- chain block times (seconds) ----------
// Used for chain-aware scoring. Includes canonical Graph IDs and common aliases.

const CHAIN_BLOCK_TIMES: Record<string, number> = {
  // L1s
  mainnet: 12,
  gnosis: 5,
  xdai: 5,      // alias
  celo: 5,
  bsc: 3,
  chapel: 3,    // BSC testnet alias
  avalanche: 2,
  fantom: 1,
  // L2s / rollups
  base: 2,
  optimism: 2,
  matic: 2,
  polygon: 2,   // alias
  'arbitrum-one': 0.25,
  'arbitrum-sepolia': 0.25,
  scroll: 3,
  linea: 3,
  'zksync-era': 1,
  'polygon-zkevm': 5,
  blast: 2,
  mode: 2,
  mantle: 2,
  'base-sepolia': 2,
  'optimism-sepolia': 2,
};

const ETH_BLOCK_TIME = 12; // baseline for normalisation

function getBlockTime(network: string): number {
  return CHAIN_BLOCK_TIMES[network] ?? ETH_BLOCK_TIME;
}

// ---------- scoring ----------

function categoryFromScore(score: number): ComplexityCategory {
  if (score < 25) return 'Light';
  if (score < 50) return 'Moderate';
  if (score < 75) return 'Heavy';
  return 'Extreme';
}

function extractHandlers(mapping: Record<string, unknown>): {
  eventHandlers: number;
  callHandlers: number;
  blockHandlers: number;
} {
  const eh = Array.isArray(mapping?.eventHandlers) ? mapping.eventHandlers.length : 0;
  const ch = Array.isArray(mapping?.callHandlers) ? mapping.callHandlers.length : 0;
  const bh = Array.isArray(mapping?.blockHandlers) ? mapping.blockHandlers.length : 0;
  return { eventHandlers: eh, callHandlers: ch, blockHandlers: bh };
}

function extractDataSource(ds: Record<string, unknown>): DataSourceSignal {
  const source = (ds.source ?? {}) as Record<string, unknown>;
  const mapping = (ds.mapping ?? {}) as Record<string, unknown>;
  const handlers = extractHandlers(mapping);

  return {
    name: String(ds.name ?? 'unknown'),
    kind: String(ds.kind ?? 'unknown'),
    network: String(ds.network ?? source.network ?? 'unknown'),
    address: source.address ? String(source.address) : null,
    startBlock: Number(source.startBlock ?? 0),
    ...handlers,
  };
}

function extractTemplate(tpl: Record<string, unknown>): TemplateSignal {
  const mapping = (tpl.mapping ?? {}) as Record<string, unknown>;
  const handlers = extractHandlers(mapping);
  const source = (tpl.source ?? {}) as Record<string, unknown>;

  return {
    name: String(tpl.name ?? 'unknown'),
    kind: String(tpl.kind ?? 'unknown'),
    network: String(tpl.network ?? source.network ?? 'unknown'),
    ...handlers,
  };
}

function computeComplexityScore(
  dataSources: DataSourceSignal[],
  templates: TemplateSignal[],
  features: string[],
  pruning: string | null,
  graft: { base: string; block: number } | null,
  network: string,
): { score: number; breakdown: ScoreBreakdown[] } {
  const breakdown: ScoreBreakdown[] = [];
  const blockTime = getBlockTime(network);

  // 1. Block range (20) — normalised to Ethereum-equivalent blocks
  // A start block of 25M on Base (2s) ≈ 4.17M on Ethereum (12s)
  const lowestStart = dataSources.reduce(
    (min, ds) => Math.min(min, ds.startBlock),
    Number.MAX_SAFE_INTEGER,
  );
  const startBlock = lowestStart === Number.MAX_SAFE_INTEGER ? 0 : lowestStart;
  const ethEquivalent = Math.round(startBlock * (blockTime / ETH_BLOCK_TIME));
  let blockScore: number;
  if (ethEquivalent === 0) blockScore = 20;
  else if (ethEquivalent < 1_000_000) blockScore = 18;
  else if (ethEquivalent < 5_000_000) blockScore = 14;
  else if (ethEquivalent < 10_000_000) blockScore = 10;
  else if (ethEquivalent < 15_000_000) blockScore = 6;
  else if (ethEquivalent < 18_000_000) blockScore = 3;
  else blockScore = 0;
  const blockRawLabel = blockTime !== ETH_BLOCK_TIME
    ? `${startBlock.toLocaleString()} (~${ethEquivalent.toLocaleString()} ETH-eq)`
    : startBlock.toLocaleString();
  breakdown.push({
    dimension: 'Block Range',
    rawValue: blockRawLabel,
    score: blockScore,
    maxScore: 20,
  });

  // 2. Handler types (25)
  const allSources = [...dataSources, ...templates];
  const hasBlock = allSources.some((s) => s.blockHandlers > 0);
  const hasCall = allSources.some((s) => s.callHandlers > 0);
  let handlerScore = 0;
  if (hasBlock) handlerScore += 18;
  if (hasCall) handlerScore += 7;
  if (!hasBlock && !hasCall) handlerScore = 0; // events only
  breakdown.push({
    dimension: 'Handler Types',
    rawValue: [
      hasBlock && 'block',
      hasCall && 'call',
      'event',
    ].filter(Boolean).join(', '),
    score: handlerScore,
    maxScore: 25,
  });

  // 3. Data source count (10)
  const dsCount = dataSources.length;
  let dsScore: number;
  if (dsCount <= 2) dsScore = 0;
  else if (dsCount <= 5) dsScore = 3;
  else if (dsCount <= 10) dsScore = 6;
  else dsScore = 10;
  breakdown.push({
    dimension: 'Data Sources',
    rawValue: String(dsCount),
    score: dsScore,
    maxScore: 10,
  });

  // 4. Templates (10)
  const tplCount = templates.length;
  let tplScore: number;
  if (tplCount === 0) tplScore = 0;
  else if (tplCount <= 2) tplScore = 3;
  else if (tplCount <= 4) tplScore = 7;
  else tplScore = 10;
  breakdown.push({
    dimension: 'Templates',
    rawValue: String(tplCount),
    score: tplScore,
    maxScore: 10,
  });

  // 5. Missing source.address (10)
  const missingAddress = dataSources.some((ds) => !ds.address);
  const addrScore = missingAddress ? 10 : 0;
  breakdown.push({
    dimension: 'Missing Address',
    rawValue: missingAddress ? 'Yes (indexes ALL contracts)' : 'All specified',
    score: addrScore,
    maxScore: 10,
  });

  // 6. Chain Throughput (15) — faster chains are harder to keep up with
  let chainScore: number;
  if (blockTime < 1) chainScore = 15;        // Arbitrum (~0.25s)
  else if (blockTime <= 2) chainScore = 12;   // Base, OP, Polygon, Avalanche
  else if (blockTime <= 4) chainScore = 8;    // BNB
  else if (blockTime <= 8) chainScore = 4;    // Gnosis, Celo
  else chainScore = 0;                        // Ethereum, slow chains
  const chainLabel = blockTime !== ETH_BLOCK_TIME
    ? `${blockTime}s blocks (${Math.round(ETH_BLOCK_TIME / blockTime)}x Ethereum)`
    : `${blockTime}s blocks`;
  breakdown.push({
    dimension: 'Chain Throughput',
    rawValue: chainLabel,
    score: chainScore,
    maxScore: 15,
  });

  // 7. Features overhead (5)
  const heavyFeatures = ['ipfsOnEthereumContracts', 'fullTextSearch', 'nonDeterministicIpfs'];
  const activeHeavy = features.filter((f) => heavyFeatures.includes(f));
  const featScore = Math.min(activeHeavy.length * 2, 5);
  breakdown.push({
    dimension: 'Features',
    rawValue: features.length > 0 ? features.join(', ') : 'None',
    score: featScore,
    maxScore: 5,
  });

  // 8. Pruning (5)
  let pruneScore: number;
  if (pruning === 'auto') pruneScore = 0;
  else pruneScore = 5; // 'never' or absent
  breakdown.push({
    dimension: 'Pruning',
    rawValue: pruning ?? 'absent',
    score: pruneScore,
    maxScore: 5,
  });

  // 9. Graft (5) — removed from score as it doesn't affect sync difficulty
  // Kept as informational row with 0 weight
  breakdown.push({
    dimension: 'Graft',
    rawValue: graft ? `From ${graft.base.slice(0, 12)}... at block ${graft.block.toLocaleString()}` : 'None',
    score: 0,
    maxScore: 0,
  });

  let total = breakdown.reduce((sum, b) => sum + b.score, 0);

  // Override rules (use normalised block for consistency)
  if (hasBlock && ethEquivalent < 5_000_000) total = 100;
  if (missingAddress && hasBlock) total = 100;

  return { score: Math.min(total, 100), breakdown };
}

// ---------- parser ----------

export function parseManifest(yamlString: string): ManifestAnalysis {
  const doc = parseYAML(yamlString) as Record<string, unknown>;

  const rawSources = Array.isArray(doc.dataSources) ? doc.dataSources : [];
  const rawTemplates = Array.isArray(doc.templates) ? doc.templates : [];
  const rawFeatures = Array.isArray(doc.features) ? doc.features.map(String) : [];
  const specVersion = String(doc.specVersion ?? 'unknown');

  const dataSources = rawSources.map((ds: Record<string, unknown>) => extractDataSource(ds));
  const templates = rawTemplates.map((tpl: Record<string, unknown>) => extractTemplate(tpl));

  const network = dataSources[0]?.network ?? 'unknown';

  // Graft detection
  const graftConfig = doc.graft as Record<string, unknown> | undefined;
  const graft = graftConfig?.base
    ? { base: String(graftConfig.base), block: Number(graftConfig.block ?? 0) }
    : null;

  // Pruning detection
  const indexerHints = doc.indexerHints as Record<string, unknown> | undefined;
  const pruning = indexerHints?.prune
    ? String(indexerHints.prune)
    : null;

  const { score, breakdown } = computeComplexityScore(
    dataSources,
    templates,
    rawFeatures,
    pruning,
    graft,
    network,
  );

  return {
    score,
    category: categoryFromScore(score),
    breakdown,
    dataSources,
    templates,
    features: rawFeatures,
    specVersion,
    network,
    graft,
    pruning,
  };
}
