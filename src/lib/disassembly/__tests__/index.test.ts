/**
 * The disassembly orchestrator.
 *
 * Read-only static analysis of somebody else's deployed artifact, which sets the tone: it must be
 * total against hostile or broken input, it must cap its own fan-out so a manifest cannot turn one
 * request into hundreds of IPFS fetches, and above all it must be honest about the limits of what
 * it computed. The caveats are not decoration; a reachability claim without them overstates what
 * static analysis can know, which is the failure mode of every tool like this.
 *
 * The IPFS and WASM layers are stubbed. The manifest parser and the scorecard are real, because
 * running them for free is worth more than isolating them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ipfsCatText = vi.fn();
const ipfsCatBytes = vi.fn();
vi.mock('../ipfs', async (orig) => ({
  ...(await orig<typeof import('../ipfs')>()),
  ipfsCatText: (...a: unknown[]) => ipfsCatText(...a),
  ipfsCatBytes: (...a: unknown[]) => ipfsCatBytes(...a),
}));

const parseWasm = vi.fn();
const analyzeHandler = vi.fn();
vi.mock('../wasm', () => ({
  parseWasm: (...a: unknown[]) => parseWasm(...a),
  analyzeHandler: (...a: unknown[]) => analyzeHandler(...a),
}));

const auditModule = vi.fn();
vi.mock('../decode-audit', () => ({ auditModule: (...a: unknown[]) => auditModule(...a) }));

import { runDisassembly } from '../index';

const ID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const WASM_A = 'QmTgpMWFvVpNQwHCDdvNmQZTFMRPGDMLpFkTKPFqYRWCsQ';
const WASM_B = 'QmPChd2hVbrJ1bfo675FnFPBGrZTNhVdVLuLBBmL3nRPWL';

const manifestYaml = (sources: string) => `
specVersion: 0.0.5
schema:
  file:
    /: /ipfs/${WASM_B}
dataSources:
${sources}
`;

const oneSource = (name: string, wasm: string) => `  - kind: ethereum/contract
    name: ${name}
    network: mainnet
    source:
      address: "0x1"
      startBlock: 1
    mapping:
      apiVersion: 0.0.7
      file:
        /: /ipfs/${wasm}
      eventHandlers:
        - event: Thing(address)
          handler: handleThing
`;

/** A parsed module as `parseWasm` would return it. */
function parsed(over: Record<string, unknown> = {}) {
  return {
    info: {
      wasmHash: WASM_A,
      byteSize: 1024,
      namedFunctions: 5,
      incomplete: false,
      hostImports: [],
      strings: [],
      ...(over.info as object),
    },
    ...over,
  };
}

function handlerResult(over: Record<string, unknown> = {}) {
  return {
    handler: 'handleThing',
    kind: 'event',
    trigger: 'Thing(address)',
    resolved: true,
    hostImports: [],
    categories: [],
    dynamicDispatch: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ipfsCatBytes.mockResolvedValue(new Uint8Array([0, 97, 115, 109]));
  parseWasm.mockImplementation(() => parsed());
  analyzeHandler.mockImplementation(() => handlerResult());
  auditModule.mockReturnValue(null);
});

describe('runDisassembly', () => {
  it('refuses anything that is not a CIDv0 before touching the network', async () => {
    await expect(runDisassembly('not-a-hash')).rejects.toThrow(/Invalid deployment ID/);
    expect(ipfsCatText).not.toHaveBeenCalled();
  });

  it('refuses an artifact that is not a manifest', async () => {
    // The hash is well-formed but points at something else entirely.
    ipfsCatText.mockResolvedValue('just some text file');
    await expect(runDisassembly(ID)).rejects.toThrow(/not a subgraph manifest/);
  });

  it('assembles a report from a single-source manifest', async () => {
    ipfsCatText.mockResolvedValue(manifestYaml(oneSource('Factory', WASM_A)));

    const r = await runDisassembly(ID);

    expect(r.deploymentId).toBe(ID);
    expect(r.manifest.specVersion).toBe('0.0.5');
    expect(r.manifest.network).toBe('mainnet');
    expect(r.manifest.apiVersions).toEqual(['0.0.7']);
    expect(r.dataSources).toHaveLength(1);
    expect(r.totals.dataSources).toBe(1);
    expect(r.totals.templates).toBe(0);
    expect(r.totals.handlers).toBe(1);
    expect(r.totals.resolvedHandlers).toBe(1);
    expect(r.totals.wasmBytes).toBe(1024);
    expect(r.scorecard.grade).toBeDefined();
  });

  it('always states that this is static analysis', async () => {
    // The caveat that keeps the whole report honest.
    ipfsCatText.mockResolvedValue(manifestYaml(oneSource('A', WASM_A)));
    const r = await runDisassembly(ID);
    expect(r.caveats[0]).toMatch(/Static analysis only/);
  });

  it('fetches each unique WASM once however many sources share it', async () => {
    ipfsCatText.mockResolvedValue(
      manifestYaml(oneSource('A', WASM_A) + oneSource('B', WASM_A) + oneSource('C', WASM_B)),
    );

    await runDisassembly(ID);

    expect(ipfsCatBytes).toHaveBeenCalledTimes(2);
    const asked = ipfsCatBytes.mock.calls.map((c) => c[0]).sort();
    expect(asked).toEqual([WASM_B, WASM_A].sort());
  });

  it('caps the data sources it will analyse, and says that it did', async () => {
    const many = Array.from({ length: 70 }, (_, i) => oneSource(`S${i}`, WASM_A)).join('');
    ipfsCatText.mockResolvedValue(manifestYaml(many));

    const r = await runDisassembly(ID);

    expect(r.dataSources).toHaveLength(60);
    expect(r.caveats.some((c) => c.includes('capped at 60'))).toBe(true);
  });

  it('records a failed WASM fetch on that data source instead of failing the report', async () => {
    ipfsCatText.mockResolvedValue(manifestYaml(oneSource('A', WASM_A)));
    ipfsCatBytes.mockRejectedValue(new Error('ipfs timeout'));

    const r = await runDisassembly(ID);

    expect(r.dataSources[0].error).toBe('ipfs timeout');
    expect(r.dataSources[0].wasm).toBeNull();
    expect(r.dataSources[0].handlers).toEqual([]);
  });

  it('stringifies a non-Error thrown by the fetch layer', async () => {
    ipfsCatText.mockResolvedValue(manifestYaml(oneSource('A', WASM_A)));
    ipfsCatBytes.mockRejectedValue('just a string');

    const r = await runDisassembly(ID);
    expect(r.dataSources[0].error).toBe('just a string');
  });

  it('reports a data source whose manifest names no WASM at all', async () => {
    ipfsCatText.mockResolvedValue(`
specVersion: 0.0.5
dataSources:
  - name: NoMapping
    kind: ethereum/contract
    network: mainnet
    mapping:
      apiVersion: 0.0.7
`);
    const r = await runDisassembly(ID);

    expect(r.dataSources[0].error).toBe('No mapping WASM referenced in manifest');
    expect(ipfsCatBytes).not.toHaveBeenCalled();
  });

  it('warns when a module used opcodes outside the modelled set', async () => {
    ipfsCatText.mockResolvedValue(manifestYaml(oneSource('A', WASM_A)));
    parseWasm.mockReturnValue(parsed({ info: { incomplete: true } }));

    const r = await runDisassembly(ID);
    expect(r.caveats.some((c) => c.includes('SIMD/atomics'))).toBe(true);
  });

  it('warns that indirect dispatch may under-count reachability', async () => {
    // AssemblyScript uses call_indirect pervasively, so silence here would overstate the analysis.
    ipfsCatText.mockResolvedValue(manifestYaml(oneSource('A', WASM_A)));
    analyzeHandler.mockReturnValue(handlerResult({ dynamicDispatch: true }));

    const r = await runDisassembly(ID);
    expect(r.caveats.some((c) => c.includes('call_indirect'))).toBe(true);
  });

  it('counts handlers the WASM does not export, and says how many', async () => {
    ipfsCatText.mockResolvedValue(manifestYaml(oneSource('A', WASM_A)));
    analyzeHandler.mockReturnValue(handlerResult({ resolved: false }));

    const r = await runDisassembly(ID);

    expect(r.totals.resolvedHandlers).toBe(0);
    expect(r.caveats.some((c) => c.includes('1 manifest handler(s) were not found'))).toBe(true);
  });

  it('carries the decode audit and its caveat when the module uses decode', async () => {
    ipfsCatText.mockResolvedValue(manifestYaml(oneSource('A', WASM_A)));
    auditModule.mockReturnValue({ usesDecode: true, unavailable: false });

    const r = await runDisassembly(ID);

    expect(r.dataSources[0].decodeAudit).toEqual({ usesDecode: true, unavailable: false });
    expect(r.caveats.some((c) => c.includes('static data-segment scan'))).toBe(true);
  });

  it('says so when the parity classifier could not be loaded', async () => {
    ipfsCatText.mockResolvedValue(manifestYaml(oneSource('A', WASM_A)));
    auditModule.mockReturnValue({ usesDecode: false, unavailable: true });

    const r = await runDisassembly(ID);
    expect(r.caveats.some((c) => c.includes('could not be loaded'))).toBe(true);
  });

  it('collects the union of host categories, sorted', async () => {
    ipfsCatText.mockResolvedValue(manifestYaml(oneSource('A', WASM_A) + oneSource('B', WASM_B)));
    analyzeHandler
      .mockReturnValueOnce(handlerResult({ categories: ['store', 'ethereum'] }))
      .mockReturnValueOnce(handlerResult({ categories: ['ethereum', 'ipfs'] }));

    const r = await runDisassembly(ID);
    expect(r.totals.hostCategories).toEqual(['ethereum', 'ipfs', 'store']);
  });

  it('separates templates from plain data sources in the totals', async () => {
    ipfsCatText.mockResolvedValue(`
specVersion: 0.0.5
dataSources:
${oneSource('Factory', WASM_A)}
templates:
${oneSource('Pair', WASM_A)}
`);
    const r = await runDisassembly(ID);

    expect(r.totals.dataSources).toBe(1);
    expect(r.totals.templates).toBe(1);
  });
});
