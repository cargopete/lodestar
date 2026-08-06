// Subgraph Disassembly orchestrator.
//
// Given a deployment ID (Qm…): fetch the manifest from IPFS, fetch + statically
// disassemble each unique mapping WASM, map every handler to its reachable host
// imports, and assemble a risk scorecard. Pure read-only analysis — nothing is
// built or executed.

import { ipfsCatBytes, ipfsCatText, IPFS_HASH_RE } from './ipfs';
import { parseDisassemblyManifest } from './manifest';
import { analyzeHandler, parseWasm, type ParsedWasm } from './wasm';
import { buildScorecard } from './scorecard';
import { auditModule } from './decode-audit';
import type {
  DataSourceReport,
  DecodeAudit,
  DisassemblyReport,
  HostCategory,
} from './types';

/** Defensive caps so a hostile manifest can't fan out unbounded fetches. */
const MAX_DATA_SOURCES = 60;
const MAX_UNIQUE_WASM = 40;

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runDisassembly(deploymentId: string): Promise<DisassemblyReport> {
  if (!IPFS_HASH_RE.test(deploymentId)) {
    throw new Error('Invalid deployment ID: expected a CIDv0 hash (Qm…)');
  }

  const yamlString = await ipfsCatText(deploymentId);
  if (!yamlString.includes('dataSources') && !yamlString.includes('specVersion')) {
    throw new Error('Artifact at that hash is not a subgraph manifest');
  }

  const manifest = parseDisassemblyManifest(yamlString);
  const caveats: string[] = [
    'Static analysis only: host-import reachability is computed from the deployed WASM, not by executing it.',
  ];

  const allSources = manifest.dataSources.slice(0, MAX_DATA_SOURCES);
  if (manifest.dataSources.length > MAX_DATA_SOURCES) {
    caveats.push(`Manifest has ${manifest.dataSources.length} data sources; analysis capped at ${MAX_DATA_SOURCES}.`);
  }

  // Fetch + parse each unique WASM once, in parallel.
  const uniqueHashes = [...new Set(allSources.map((d) => d.wasmHash).filter((h): h is string => !!h))].slice(0, MAX_UNIQUE_WASM);
  const wasmByHash = new Map<string, ParsedWasm | { error: string }>();

  await Promise.all(
    uniqueHashes.map(async (hash) => {
      try {
        const bytes = await ipfsCatBytes(hash);
        wasmByHash.set(hash, parseWasm(bytes, hash));
      } catch (e) {
        wasmByHash.set(hash, { error: errMessage(e) });
      }
    }),
  );

  const dataSources: DataSourceReport[] = allSources.map((ds) => {
    const parsed = ds.wasmHash ? wasmByHash.get(ds.wasmHash) : undefined;

    if (!ds.wasmHash) {
      return baseReport(ds, null, [], 'No mapping WASM referenced in manifest');
    }
    if (!parsed) {
      return baseReport(ds, null, [], 'Mapping WASM not fetched (capped)');
    }
    if ('error' in parsed) {
      return baseReport(ds, null, [], parsed.error);
    }

    const handlers = ds.handlers.map((h) => analyzeHandler(parsed, h));
    const report = baseReport(ds, parsed.info, handlers, null);
    // Static ethereum.decode / graph-node 0.42 alloy-migration audit — a pure
    // function of the WASM bytes, so it rides the same content-addressed cache.
    report.decodeAudit = auditModule(parsed.info);
    return report;
  });

  // Caveats derived from analysis quality.
  if (dataSources.some((d) => d.wasm?.incomplete)) {
    caveats.push('At least one module used opcodes outside the modelled set (SIMD/atomics/post-MVP); some reachability is partial.');
  }
  if (dataSources.some((d) => d.handlers.some((h) => h.dynamicDispatch))) {
    caveats.push('AssemblyScript uses dynamic dispatch (call_indirect) pervasively; reachability is computed over direct calls and may under-count paths that route exclusively through indirect dispatch.');
  }
  const unresolved = dataSources.reduce((s, d) => s + d.handlers.filter((h) => !h.resolved && d.wasm).length, 0);
  if (unresolved > 0) {
    caveats.push(`${unresolved} manifest handler(s) were not found as exports in their WASM (possible apiVersion/naming skew).`);
  }
  const decodeAudits = dataSources
    .map((d) => d.decodeAudit)
    .filter((a): a is DecodeAudit => !!a);
  if (decodeAudits.some((a) => a.usesDecode)) {
    caveats.push('Decode Compatibility Audit is a static data-segment scan with no dataflow, so flagged type strings may not be the exact argument passed to ethereum.decode, and dynamically built type strings are not detected.');
  }
  if (decodeAudits.some((a) => a.unavailable)) {
    caveats.push('The exact-parity ethabi/alloy classifier could not be loaded in this runtime; decode compatibility could not be evaluated for some modules.');
  }

  const scorecard = buildScorecard(manifest, dataSources);

  const handlerCount = dataSources.reduce((s, d) => s + d.handlers.length, 0);
  const resolvedHandlers = dataSources.reduce((s, d) => s + d.handlers.filter((h) => h.resolved).length, 0);
  const wasmBytes = [...wasmByHash.values()].reduce((s, p) => s + ('error' in p ? 0 : p.info.byteSize), 0);
  const hostCategories = [
    ...new Set(dataSources.flatMap((d) => d.handlers.flatMap((h) => h.categories))),
  ].sort() as HostCategory[];

  return {
    deploymentId,
    manifest: {
      specVersion: manifest.specVersion,
      apiVersions: [...new Set(allSources.map((d) => d.apiVersion))].sort(),
      network: manifest.network,
      features: manifest.features,
      schemaHash: manifest.schemaHash,
      graft: manifest.graft,
    },
    dataSources,
    scorecard,
    totals: {
      dataSources: allSources.filter((d) => !d.isTemplate).length,
      templates: allSources.filter((d) => d.isTemplate).length,
      handlers: handlerCount,
      resolvedHandlers,
      wasmBytes,
      hostCategories,
    },
    caveats,
  };
}

function baseReport(
  ds: { name: string; kind: string; isTemplate: boolean; network: string; address: string | null; startBlock: number; apiVersion: string; wasmHash: string | null; abis: { name: string; hash: string | null }[] },
  wasm: DataSourceReport['wasm'],
  handlers: DataSourceReport['handlers'],
  error: string | null,
): DataSourceReport {
  return {
    name: ds.name,
    kind: ds.kind,
    isTemplate: ds.isTemplate,
    network: ds.network,
    address: ds.address,
    startBlock: ds.startBlock,
    apiVersion: ds.apiVersion,
    wasmHash: ds.wasmHash,
    wasm,
    handlers,
    abis: ds.abis,
    error,
  };
}
