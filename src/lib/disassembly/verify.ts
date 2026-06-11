// Subgraph Disassembly — source-to-deployment verdict engine (Phase 2).
//
// Given the WASM a build produced and the WASM that's actually deployed, decide
// whether the deployment faithfully corresponds to the source. Two levels:
//   - byte-identical (sha256) → the strongest possible proof (verified-exact)
//   - structurally identical host-API surface → same capabilities, bytes differ
//     only by build-toolchain noise (verified-structural)
//   - otherwise the deployed artifact can reach host APIs the source can't (or
//     vice versa) → diverged.
// Pure and deterministic: it never builds or fetches anything itself.

import { createHash } from 'node:crypto';
import { parseWasm } from './wasm';

export type ModuleStatus = 'exact' | 'structural' | 'diverged' | 'only-built' | 'only-deployed';

export interface ModuleComparison {
  /** data-source name (the key both sides are matched on) */
  name: string;
  status: ModuleStatus;
  builtBytes: number | null;
  deployedBytes: number | null;
  builtSha256: string | null;
  deployedSha256: string | null;
  /** host-API labels reachable in the built module but not the deployed one */
  hostImportsAdded: string[];
  /** host-API labels in the deployed module but not the built one */
  hostImportsRemoved: string[];
  /** recovered-string deltas — informational (debug paths/names are noisy) */
  stringsAdded: number;
  stringsRemoved: number;
}

export type OverallVerdict = 'verified-exact' | 'verified-structural' | 'diverged';

export interface VerifyComparison {
  verdict: OverallVerdict;
  modules: ModuleComparison[];
  summary: { exact: number; structural: number; diverged: number; missing: number; total: number };
}

export interface NamedModule {
  name: string;
  bytes: Uint8Array;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hostLabels(bytes: Uint8Array): string[] {
  try {
    return parseWasm(bytes, 'cmp').info.hostImports.map((h) => h.label).sort();
  } catch {
    return [];
  }
}

function recoveredStrings(bytes: Uint8Array): string[] {
  try {
    return parseWasm(bytes, 'cmp').info.strings;
  } catch {
    return [];
  }
}

function setDiff(from: string[], to: string[]): { added: string[]; removed: string[] } {
  const F = new Set(from);
  const T = new Set(to);
  return { added: to.filter((x) => !F.has(x)), removed: from.filter((x) => !T.has(x)) };
}

function blank(name: string, status: ModuleStatus, built: Uint8Array | null, deployed: Uint8Array | null): ModuleComparison {
  return {
    name,
    status,
    builtBytes: built ? built.length : null,
    deployedBytes: deployed ? deployed.length : null,
    builtSha256: built ? sha256Hex(built) : null,
    deployedSha256: deployed ? sha256Hex(deployed) : null,
    hostImportsAdded: [],
    hostImportsRemoved: [],
    stringsAdded: 0,
    stringsRemoved: 0,
  };
}

/**
 * Compare the modules a build produced against the deployed modules, matched by
 * data-source name. `built`/`deployed` are name→bytes pairs.
 */
export function compareBuild(built: NamedModule[], deployed: NamedModule[]): VerifyComparison {
  const builtMap = new Map(built.map((m) => [m.name, m.bytes]));
  const deployedMap = new Map(deployed.map((m) => [m.name, m.bytes]));
  const names = [...new Set([...builtMap.keys(), ...deployedMap.keys()])].sort();

  const modules: ModuleComparison[] = names.map((name) => {
    const b = builtMap.get(name);
    const d = deployedMap.get(name);

    if (b && !d) return blank(name, 'only-built', b, null);
    if (!b && d) return blank(name, 'only-deployed', null, d);

    const builtSha = sha256Hex(b!);
    const deployedSha = sha256Hex(d!);
    if (builtSha === deployedSha) return blank(name, 'exact', b!, d!);

    // Bytes differ — fall back to structural comparison of the host-API surface.
    const hosts = setDiff(hostLabels(d!), hostLabels(b!));
    const strings = setDiff(recoveredStrings(d!), recoveredStrings(b!));
    const sameSurface = hosts.added.length === 0 && hosts.removed.length === 0;

    return {
      name,
      status: sameSurface ? 'structural' : 'diverged',
      builtBytes: b!.length,
      deployedBytes: d!.length,
      builtSha256: builtSha,
      deployedSha256: deployedSha,
      hostImportsAdded: hosts.added,
      hostImportsRemoved: hosts.removed,
      stringsAdded: strings.added.length,
      stringsRemoved: strings.removed.length,
    };
  });

  const summary = {
    exact: modules.filter((m) => m.status === 'exact').length,
    structural: modules.filter((m) => m.status === 'structural').length,
    diverged: modules.filter((m) => m.status === 'diverged').length,
    missing: modules.filter((m) => m.status === 'only-built' || m.status === 'only-deployed').length,
    total: modules.length,
  };

  let verdict: OverallVerdict;
  if (summary.diverged > 0 || summary.missing > 0) verdict = 'diverged';
  else if (summary.structural > 0) verdict = 'verified-structural';
  else verdict = 'verified-exact';

  return { verdict, modules, summary };
}
