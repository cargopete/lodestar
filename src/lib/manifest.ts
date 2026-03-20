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
): { score: number; breakdown: ScoreBreakdown[] } {
  const breakdown: ScoreBreakdown[] = [];

  // 1. Block range (25) — lowest startBlock across all sources
  const lowestStart = dataSources.reduce(
    (min, ds) => Math.min(min, ds.startBlock),
    Number.MAX_SAFE_INTEGER,
  );
  const startBlock = lowestStart === Number.MAX_SAFE_INTEGER ? 0 : lowestStart;
  let blockScore: number;
  if (startBlock === 0) blockScore = 25;
  else if (startBlock < 1_000_000) blockScore = 22;
  else if (startBlock < 5_000_000) blockScore = 18;
  else if (startBlock < 10_000_000) blockScore = 12;
  else if (startBlock < 15_000_000) blockScore = 8;
  else if (startBlock < 18_000_000) blockScore = 4;
  else blockScore = 0;
  breakdown.push({
    dimension: 'Block Range',
    rawValue: startBlock.toLocaleString(),
    score: blockScore,
    maxScore: 25,
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

  // 4. Templates (15)
  const tplCount = templates.length;
  let tplScore: number;
  if (tplCount === 0) tplScore = 0;
  else if (tplCount <= 2) tplScore = 5;
  else if (tplCount <= 4) tplScore = 10;
  else tplScore = 15;
  breakdown.push({
    dimension: 'Templates',
    rawValue: String(tplCount),
    score: tplScore,
    maxScore: 15,
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

  // 6. Features overhead (5)
  const heavyFeatures = ['ipfsOnEthereumContracts', 'fullTextSearch', 'nonDeterministicIpfs'];
  const activeHeavy = features.filter((f) => heavyFeatures.includes(f));
  const featScore = Math.min(activeHeavy.length * 2, 5);
  breakdown.push({
    dimension: 'Features',
    rawValue: features.length > 0 ? features.join(', ') : 'None',
    score: featScore,
    maxScore: 5,
  });

  // 7. Pruning (5)
  let pruneScore: number;
  if (pruning === 'auto') pruneScore = 0;
  else pruneScore = 5; // 'never' or absent
  breakdown.push({
    dimension: 'Pruning',
    rawValue: pruning ?? 'absent',
    score: pruneScore,
    maxScore: 5,
  });

  // 8. Graft (5)
  const graftScore = graft ? 5 : 0;
  breakdown.push({
    dimension: 'Graft',
    rawValue: graft ? `From ${graft.base.slice(0, 12)}... at block ${graft.block.toLocaleString()}` : 'None',
    score: graftScore,
    maxScore: 5,
  });

  let total = breakdown.reduce((sum, b) => sum + b.score, 0);

  // Override rules
  if (hasBlock && startBlock < 5_000_000) total = 100;
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
