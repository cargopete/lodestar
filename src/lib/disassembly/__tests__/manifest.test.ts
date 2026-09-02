/**
 * Deploy-grade manifest parsing.
 *
 * This reads YAML that somebody else published and that nobody validated on the way in, so the
 * job is to be total: every field has a fallback and nothing throws. The failure worth avoiding is
 * a parse that half-succeeds, because a data source silently missing its WASM hash disappears from
 * the disassembly without anything reporting a gap.
 */
import { describe, it, expect } from 'vitest';
import { parseDisassemblyManifest } from '../manifest';

const WASM = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const SCHEMA = 'QmTgpMWFvVpNQwHCDdvNmQZTFMRPGDMLpFkTKPFqYRWCsQ';
const ABI = 'QmPChd2hVbrJ1bfo675FnFPBGrZTNhVdVLuLBBmL3nRPWL';

const FULL = `
specVersion: 0.0.5
features:
  - fullTextSearch
  - nonFatalErrors
schema:
  file:
    /: /ipfs/${SCHEMA}
graft:
  base: QmBaseDeploymentHashHere
  block: 12345678
dataSources:
  - kind: ethereum/contract
    name: Factory
    network: mainnet
    source:
      address: "0xABCDEF"
      abi: Factory
      startBlock: 10000834
    mapping:
      apiVersion: 0.0.7
      file:
        /: /ipfs/${WASM}
      abis:
        - name: Factory
          file:
            /: /ipfs/${ABI}
      eventHandlers:
        - event: PairCreated(indexed address,indexed address,address,uint256)
          handler: handleNewPair
      callHandlers:
        - function: setFeeTo(address)
          handler: handleSetFeeTo
      blockHandlers:
        - handler: handleBlock
          filter:
            kind: call
        - handler: handleEveryTen
          filter:
            every: 10
        - handler: handleBareBlock
templates:
  - kind: ethereum/contract
    name: Pair
    network: mainnet
    source:
      abi: Pair
    mapping:
      apiVersion: 0.0.6
      file:
        /: /ipfs/${WASM}
      eventHandlers:
        - event: Swap(indexed address,uint256)
          handler: handleSwap
`;

describe('parseDisassemblyManifest', () => {
  it('reads the top-level facts', () => {
    const m = parseDisassemblyManifest(FULL);

    expect(m.specVersion).toBe('0.0.5');
    expect(m.features).toEqual(['fullTextSearch', 'nonFatalErrors']);
    expect(m.schemaHash).toBe(SCHEMA);
    expect(m.graft).toEqual({ base: 'QmBaseDeploymentHashHere', block: 12345678 });
  });

  it('takes the network from a real data source rather than a template', () => {
    const m = parseDisassemblyManifest(FULL);
    expect(m.network).toBe('mainnet');
  });

  it('parses data sources and templates, marking which is which', () => {
    const m = parseDisassemblyManifest(FULL);

    expect(m.dataSources).toHaveLength(2);
    const [factory, pair] = m.dataSources;

    expect(factory.name).toBe('Factory');
    expect(factory.isTemplate).toBe(false);
    expect(factory.address).toBe('0xABCDEF');
    expect(factory.startBlock).toBe(10000834);
    expect(factory.apiVersion).toBe('0.0.7');
    expect(factory.wasmHash).toBe(WASM);
    expect(factory.abis).toEqual([{ name: 'Factory', hash: ABI }]);

    expect(pair.name).toBe('Pair');
    expect(pair.isTemplate).toBe(true);
    // A template has no address until runtime, which is a null rather than a fault.
    expect(pair.address).toBeNull();
  });

  it('extracts each handler kind with its trigger', () => {
    const [factory] = parseDisassemblyManifest(FULL).dataSources;

    expect(factory.handlers).toEqual([
      {
        handler: 'handleNewPair',
        kind: 'event',
        trigger: 'PairCreated(indexed address,indexed address,address,uint256)',
      },
      { handler: 'handleSetFeeTo', kind: 'call', trigger: 'setFeeTo(address)' },
      { handler: 'handleBlock', kind: 'block', trigger: 'filter: call' },
      { handler: 'handleEveryTen', kind: 'block', trigger: 'every 10 blocks' },
      { handler: 'handleBareBlock', kind: 'block', trigger: null },
    ]);
  });

  it('accepts a plain-string ipfs ref as well as the link object', () => {
    // Both forms appear in the wild, and a manifest using the older one must not lose its WASM.
    const m = parseDisassemblyManifest(`
specVersion: 0.0.4
dataSources:
  - name: Old
    kind: ethereum/contract
    network: mainnet
    source:
      address: "0x1"
    mapping:
      apiVersion: 0.0.5
      file: /ipfs/${WASM}
`);
    expect(m.dataSources[0].wasmHash).toBe(WASM);
  });

  it('returns a null hash for a ref that is not an ipfs CID', () => {
    const m = parseDisassemblyManifest(`
dataSources:
  - name: Broken
    mapping:
      file: not-a-cid
`);
    expect(m.dataSources[0].wasmHash).toBeNull();
  });

  it('drops a handler entry with no handler name rather than inventing one', () => {
    const m = parseDisassemblyManifest(`
dataSources:
  - name: Partial
    mapping:
      eventHandlers:
        - event: Thing(address)
      callHandlers:
        - function: doIt()
      blockHandlers:
        - filter:
            kind: call
`);
    expect(m.dataSources[0].handlers).toEqual([]);
  });

  it('falls back on every missing field instead of throwing', () => {
    const m = parseDisassemblyManifest(`
dataSources:
  - {}
`);
    expect(m.dataSources[0]).toMatchObject({
      name: 'unknown',
      kind: 'unknown',
      network: 'unknown',
      address: null,
      startBlock: 0,
      apiVersion: 'unknown',
      wasmHash: null,
      abis: [],
      handlers: [],
    });
    expect(m.specVersion).toBe('unknown');
    expect(m.network).toBe('unknown');
  });

  it('handles an entirely empty manifest', () => {
    const m = parseDisassemblyManifest('{}');
    expect(m.dataSources).toEqual([]);
    expect(m.features).toEqual([]);
    expect(m.schemaHash).toBeNull();
    expect(m.graft).toBeNull();
    expect(m.network).toBe('unknown');
  });

  it('reports no graft when the block is missing but a base is given', () => {
    const m = parseDisassemblyManifest(`
graft:
  base: QmBase
`);
    expect(m.graft).toEqual({ base: 'QmBase', block: 0 });
  });

  it('reports no graft at all when there is no base', () => {
    expect(parseDisassemblyManifest('graft:\n  block: 5\n').graft).toBeNull();
  });

  it('ignores dataSources and templates that are not lists', () => {
    const m = parseDisassemblyManifest('dataSources: nonsense\ntemplates: 7\nfeatures: 3\n');
    expect(m.dataSources).toEqual([]);
    expect(m.features).toEqual([]);
  });

  it('reads the network off the source when the data source omits it', () => {
    const m = parseDisassemblyManifest(`
dataSources:
  - name: A
    source:
      network: arbitrum-one
`);
    expect(m.dataSources[0].network).toBe('arbitrum-one');
    expect(m.network).toBe('arbitrum-one');
  });

  it('names an ABI entry that has none rather than dropping it', () => {
    // An unnamed ABI is still a file the deployment depends on; losing it would understate the
    // artifact's surface.
    const m = parseDisassemblyManifest(`
dataSources:
  - name: A
    mapping:
      abis:
        - file: /ipfs/${ABI}
`);
    expect(m.dataSources[0].abis).toEqual([{ name: 'unknown', hash: ABI }]);
  });

  it('falls back to a template network when there is no plain data source', () => {
    const m = parseDisassemblyManifest(`
templates:
  - name: T
    network: matic
`);
    expect(m.network).toBe('matic');
  });
});
