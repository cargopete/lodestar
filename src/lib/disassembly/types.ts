// Subgraph Disassembly — shared types.
//
// Phase 1: fetch the *deployed* WASM + manifest straight from IPFS by deployment
// ID, statically disassemble each mapping module, and enumerate which host imports
// each handler can reach. No build, no sandbox, no execution — pure static analysis.

/** Host-API families exposed by graph-node to mappings. */
export type HostCategory =
  | 'store'
  | 'ethereum'
  | 'ipfs'
  | 'json'
  | 'crypto'
  | 'bigInt'
  | 'bigDecimal'
  | 'typeConversion'
  | 'dataSource'
  | 'log'
  | 'control' // abort / runtime — not surfaced as a handler signal
  | 'other'; // non-host import (memory/runtime helpers)

/** A single imported function in a mapping module. */
export interface HostImport {
  module: string;
  name: string;
  /** canonical dotted label, e.g. "ethereum.call" */
  label: string;
  category: HostCategory;
  /** index in the module's function index space */
  funcIndex: number;
  /** whether graph-node recognises this as a host import (vs AS runtime noise) */
  isHost: boolean;
}

/** Result of statically analysing one exported handler. */
export interface HandlerAnalysis {
  /** exported function name the manifest points at */
  handler: string;
  kind: 'event' | 'call' | 'block';
  /** event signature / call function / block filter, for display */
  trigger: string | null;
  /** the exported function was found in the WASM export section */
  resolved: boolean;
  /** meaningful host-import labels reachable from this handler (excludes control/other) */
  hostImports: string[];
  /** deduped meaningful host categories reachable */
  categories: HostCategory[];
  /** reachable via a call_indirect — reachability may be under-counted */
  dynamicDispatch: boolean;
  /** some reachable function body could not be fully decoded */
  incomplete: boolean;
}

/** Static facts recovered from one mapping WASM module. */
export interface WasmModuleInfo {
  wasmHash: string;
  byteSize: number;
  /** imported + defined */
  functionCount: number;
  importedFunctionCount: number;
  definedFunctionCount: number;
  /** recognised host imports present in the module */
  hostImports: HostImport[];
  /** count of non-host (runtime/memory) imports */
  otherImportCount: number;
  /** readable strings recovered from data segments (entity types, event sigs, log formats) */
  strings: string[];
  /** functions named in the custom "name" section (richer when built with --debug) */
  namedFunctions: number;
  /** parser could not fully decode at least one function body */
  incomplete: boolean;
  notes: string[];
}

export interface DataSourceReport {
  name: string;
  kind: string;
  isTemplate: boolean;
  network: string;
  address: string | null;
  startBlock: number;
  apiVersion: string;
  wasmHash: string | null;
  wasm: WasmModuleInfo | null;
  handlers: HandlerAnalysis[];
  abis: { name: string; hash: string | null }[];
  /** populated when the WASM could not be fetched/parsed */
  error: string | null;
}

export interface DeployManifestInfo {
  specVersion: string;
  apiVersions: string[];
  network: string;
  features: string[];
  schemaHash: string | null;
  graft: { base: string; block: number } | null;
}

export type FlagLevel = 'info' | 'warn' | 'critical';

export interface RiskFlag {
  level: FlagLevel;
  title: string;
  detail: string;
}

export interface CategoryScore {
  name: string;
  /** 0–100, higher = cleaner/safer */
  score: number;
  note: string;
}

export interface Scorecard {
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  /** 0–100, higher = riskier */
  riskScore: number;
  flags: RiskFlag[];
  categories: CategoryScore[];
}

export interface DisassemblyReport {
  deploymentId: string;
  manifest: DeployManifestInfo;
  dataSources: DataSourceReport[];
  scorecard: Scorecard;
  totals: {
    dataSources: number;
    templates: number;
    handlers: number;
    resolvedHandlers: number;
    wasmBytes: number;
    hostCategories: HostCategory[];
  };
  caveats: string[];
}
