// Deploy-grade manifest extraction for Subgraph Disassembly.
//
// The existing src/lib/manifest.ts parses for a *complexity* score and never
// surfaces the per-dataSource WASM hashes, apiVersion, ABIs, or individual
// handlers — all of which the disassembler needs. So this is a separate, richer
// pass over the same YAML.

import { parse as parseYAML } from 'yaml';

const IPFS_REF_RE = /Qm[1-9A-HJ-NP-Za-km-z]{44}/;

export interface ParsedHandler {
  handler: string;
  kind: 'event' | 'call' | 'block';
  /** event signature, call function, or block-handler filter description */
  trigger: string | null;
}

export interface ParsedDataSource {
  name: string;
  kind: string;
  isTemplate: boolean;
  network: string;
  address: string | null;
  startBlock: number;
  apiVersion: string;
  wasmHash: string | null;
  abis: { name: string; hash: string | null }[];
  handlers: ParsedHandler[];
}

export interface ParsedManifest {
  specVersion: string;
  network: string;
  features: string[];
  schemaHash: string | null;
  graft: { base: string; block: number } | null;
  dataSources: ParsedDataSource[];
}

/** A manifest file ref is either "/ipfs/Qm…" or { "/": "/ipfs/Qm…" }. */
function ipfsRef(val: unknown): string | null {
  let raw = '';
  if (typeof val === 'string') raw = val;
  else if (val && typeof val === 'object') raw = (val as Record<string, string>)['/'] ?? '';
  const m = raw.match(IPFS_REF_RE);
  return m ? m[0] : null;
}

function asRecord(val: unknown): Record<string, unknown> {
  return val && typeof val === 'object' ? (val as Record<string, unknown>) : {};
}

function extractHandlers(mapping: Record<string, unknown>): ParsedHandler[] {
  const out: ParsedHandler[] = [];

  const eventHandlers = Array.isArray(mapping.eventHandlers) ? mapping.eventHandlers : [];
  for (const h of eventHandlers) {
    const r = asRecord(h);
    if (r.handler) out.push({ handler: String(r.handler), kind: 'event', trigger: r.event ? String(r.event) : null });
  }

  const callHandlers = Array.isArray(mapping.callHandlers) ? mapping.callHandlers : [];
  for (const h of callHandlers) {
    const r = asRecord(h);
    if (r.handler) out.push({ handler: String(r.handler), kind: 'call', trigger: r.function ? String(r.function) : null });
  }

  const blockHandlers = Array.isArray(mapping.blockHandlers) ? mapping.blockHandlers : [];
  for (const h of blockHandlers) {
    const r = asRecord(h);
    if (!r.handler) continue;
    const filter = asRecord(r.filter);
    let trigger: string | null = null;
    if (filter.kind) trigger = `filter: ${String(filter.kind)}`;
    else if (typeof filter.every === 'number') trigger = `every ${filter.every} blocks`;
    out.push({ handler: String(r.handler), kind: 'block', trigger });
  }

  return out;
}

function extractAbis(mapping: Record<string, unknown>): { name: string; hash: string | null }[] {
  const abis = Array.isArray(mapping.abis) ? mapping.abis : [];
  return abis.map((a) => {
    const r = asRecord(a);
    return { name: String(r.name ?? 'unknown'), hash: ipfsRef(r.file) };
  });
}

function extractDataSource(ds: Record<string, unknown>, isTemplate: boolean): ParsedDataSource {
  const source = asRecord(ds.source);
  const mapping = asRecord(ds.mapping);
  return {
    name: String(ds.name ?? 'unknown'),
    kind: String(ds.kind ?? 'unknown'),
    isTemplate,
    network: String(ds.network ?? source.network ?? 'unknown'),
    address: source.address ? String(source.address) : null,
    startBlock: Number(source.startBlock ?? 0),
    apiVersion: String(mapping.apiVersion ?? 'unknown'),
    wasmHash: ipfsRef(mapping.file),
    abis: extractAbis(mapping),
    handlers: extractHandlers(mapping),
  };
}

export function parseDisassemblyManifest(yamlString: string): ParsedManifest {
  const doc = asRecord(parseYAML(yamlString));

  const rawSources = Array.isArray(doc.dataSources) ? doc.dataSources : [];
  const rawTemplates = Array.isArray(doc.templates) ? doc.templates : [];

  const dataSources: ParsedDataSource[] = [
    ...rawSources.map((d) => extractDataSource(asRecord(d), false)),
    ...rawTemplates.map((d) => extractDataSource(asRecord(d), true)),
  ];

  const features = Array.isArray(doc.features) ? doc.features.map(String) : [];
  const network = dataSources.find((d) => !d.isTemplate)?.network ?? dataSources[0]?.network ?? 'unknown';

  const schemaConfig = asRecord(doc.schema);
  const schemaHash = ipfsRef(schemaConfig.file);

  const graftConfig = asRecord(doc.graft);
  const graft = graftConfig.base
    ? { base: String(graftConfig.base), block: Number(graftConfig.block ?? 0) }
    : null;

  return {
    specVersion: String(doc.specVersion ?? 'unknown'),
    network,
    features,
    schemaHash,
    graft,
    dataSources,
  };
}
