// Risk scorecard for a disassembled subgraph.
//
// A Socket-style transparency report: from the manifest + per-handler host-import
// reachability, surface determinism / performance / footprint signals. Every flag
// is grounded in a real graph-node failure or cost mode (eth_calls dominate sync
// time; fulltext is non-deterministic and fatal; ipfs is non-deterministic; etc.).

import type {
  CategoryScore,
  DataSourceReport,
  FlagLevel,
  HostCategory,
  RiskFlag,
  Scorecard,
} from './types';
import type { ParsedManifest } from './manifest';

const FLAG_WEIGHT: Record<FlagLevel, number> = {
  critical: 30,
  warn: 12,
  info: 3,
};

function gradeFor(risk: number): Scorecard['grade'] {
  if (risk < 10) return 'A';
  if (risk < 25) return 'B';
  if (risk < 50) return 'C';
  if (risk < 75) return 'D';
  return 'F';
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Which handlers (across all data sources) reach a given host category. */
function handlersReaching(dataSources: DataSourceReport[], category: HostCategory): number {
  let count = 0;
  for (const ds of dataSources) {
    for (const h of ds.handlers) {
      if (h.categories.includes(category)) count++;
    }
  }
  return count;
}

export function buildScorecard(manifest: ParsedManifest, dataSources: DataSourceReport[]): Scorecard {
  const flags: RiskFlag[] = [];

  const ethCallHandlers = handlersReaching(dataSources, 'ethereum');
  const ipfsHandlers = handlersReaching(dataSources, 'ipfs');
  const dynamicDsHandlers = handlersReaching(dataSources, 'dataSource');

  const hasCallHandlers = dataSources.some((d) => d.handlers.some((h) => h.kind === 'call'));
  const hasBlockHandlers = dataSources.some((d) => d.handlers.some((h) => h.kind === 'block'));
  const wildcard = dataSources.some((d) => !d.isTemplate && d.address === null && d.handlers.some((h) => h.kind === 'event'));

  const features = manifest.features;
  const hasFulltext = features.includes('fullTextSearch');
  const hasNonDetIpfs = features.includes('nonDeterministicIpfs') || features.includes('ipfsOnEthereumContracts');

  // --- determinism / correctness ---
  if (hasFulltext) {
    flags.push({ level: 'critical', title: 'Full-text search enabled', detail: 'Fulltext indexing is not deterministic and is a known fatal-panic source in graph-node.' });
  }
  if (ipfsHandlers > 0 || hasNonDetIpfs) {
    flags.push({ level: 'warn', title: 'IPFS / file-data access', detail: `${ipfsHandlers} handler(s) reach ipfs.* — file data sources and on-chain IPFS reads are non-deterministic.` });
  }
  if (manifest.graft) {
    flags.push({ level: 'info', title: 'Grafted deployment', detail: `Built on ${manifest.graft.base.slice(0, 14)}… at block ${manifest.graft.block.toLocaleString()}; history is inherited, not re-derived.` });
  }

  // --- performance / sync cost ---
  if (ethCallHandlers > 0) {
    flags.push({ level: 'warn', title: 'eth_call in handlers', detail: `${ethCallHandlers} handler(s) reach ethereum.call — synchronous contract reads dominate indexing time and add revert/determinism risk.` });
  }
  if (hasBlockHandlers) {
    flags.push({ level: 'warn', title: 'Block handlers', detail: 'Block handlers run per matching block and can sharply increase sync cost; call-filtered variants also require trace data.' });
  }
  if (hasCallHandlers) {
    flags.push({ level: 'info', title: 'Call handlers', detail: 'Call handlers require transaction call traces (EXTENDED Firehose / trace-capable RPC) — heavier to index.' });
  }

  // --- footprint / surface ---
  if (wildcard) {
    flags.push({ level: 'warn', title: 'Wildcard indexing', detail: 'A data source has no source.address — it matches events from ALL contracts, a large index surface.' });
  }
  if (dynamicDsHandlers > 0) {
    flags.push({ level: 'info', title: 'Dynamic data sources', detail: `${dynamicDsHandlers} handler(s) reach dataSource.create* — templates are spawned at runtime, so the indexed surface grows during sync.` });
  }
  if (features.includes('nonFatalErrors')) {
    flags.push({ level: 'info', title: 'Non-fatal errors', detail: 'Subgraph continues past handler errors; data may be partial without halting.' });
  }

  const riskScore = clamp(flags.reduce((sum, f) => sum + FLAG_WEIGHT[f.level], 0));

  // --- category scores (higher = cleaner) ---
  let determinism = 100;
  if (hasFulltext) determinism -= 45;
  if (ipfsHandlers > 0 || hasNonDetIpfs) determinism -= 30;
  if (ethCallHandlers > 0) determinism -= 12;
  if (manifest.graft) determinism -= 8;

  let performance = 100;
  if (ethCallHandlers > 0) performance -= Math.min(45, 12 + ethCallHandlers * 4);
  if (hasBlockHandlers) performance -= 20;
  if (hasCallHandlers) performance -= 12;
  if (wildcard) performance -= 15;

  // Transparency: how legible is the deployed artifact? Named functions + clean decode.
  const namedTotal = dataSources.reduce((s, d) => s + (d.wasm?.namedFunctions ?? 0), 0);
  const anyIncomplete = dataSources.some((d) => d.wasm?.incomplete);
  let transparency = namedTotal > 0 ? 85 : 55;
  if (anyIncomplete) transparency -= 20;

  const categories: CategoryScore[] = [
    { name: 'Determinism', score: clamp(determinism), note: hasFulltext || ipfsHandlers > 0 || hasNonDetIpfs ? 'Non-deterministic surface present' : 'No non-deterministic host usage found' },
    { name: 'Performance', score: clamp(performance), note: ethCallHandlers > 0 ? 'Synchronous eth_calls in handlers' : 'No eth_call hotspots found' },
    { name: 'Transparency', score: clamp(transparency), note: namedTotal > 0 ? 'Function names recovered from name section' : 'Sparse name section' },
  ];

  return { grade: gradeFor(riskScore), riskScore, flags, categories };
}
