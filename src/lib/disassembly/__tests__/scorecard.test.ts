/**
 * Risk scorecard for a disassembled subgraph.
 *
 * This is a judgement rendered as a letter, so the thing worth pinning is that each flag is
 * actually earned by something in the manifest or the reachability analysis. A grade that drifts
 * loose from its evidence is worse than no grade, because it reads with the same confidence.
 *
 * The individual weights are policy and may be tuned; what these tests hold is the shape of the
 * policy: that a fatal-panic source outranks a cost signal, that clean input really does score
 * clean, and that the numbers stay inside their stated ranges.
 */
import { describe, it, expect } from 'vitest';
import { buildScorecard } from '../scorecard';
import type { DataSourceReport, HostCategory } from '../types';
import type { ParsedManifest } from '../manifest';

function manifest(over: Partial<ParsedManifest> = {}): ParsedManifest {
  return {
    specVersion: '0.0.5',
    network: 'mainnet',
    features: [],
    schemaHash: 'QmSchema',
    graft: null,
    dataSources: [],
    ...over,
  };
}

function handler(
  over: { kind?: 'event' | 'call' | 'block'; categories?: HostCategory[] } = {},
) {
  return {
    handler: 'handleThing',
    kind: over.kind ?? ('event' as const),
    trigger: 'Thing(address)',
    resolved: true,
    hostImports: [],
    categories: over.categories ?? [],
    viaIndirect: false,
  } as unknown as DataSourceReport['handlers'][number];
}

function dataSource(over: Partial<DataSourceReport> = {}): DataSourceReport {
  return {
    name: 'Factory',
    kind: 'ethereum/contract',
    isTemplate: false,
    network: 'mainnet',
    address: '0xabc',
    startBlock: 1,
    apiVersion: '0.0.7',
    wasmHash: 'QmWasm',
    wasm: { namedFunctions: 10, incomplete: false } as unknown as DataSourceReport['wasm'],
    handlers: [handler()],
    abis: [],
    error: null,
    ...over,
  };
}

const titles = (s: ReturnType<typeof buildScorecard>) => s.flags.map((f) => f.title);
const category = (s: ReturnType<typeof buildScorecard>, name: string) =>
  s.categories.find((c) => c.name === name)!;

describe('buildScorecard', () => {
  it('grades a clean subgraph A with no flags', () => {
    const s = buildScorecard(manifest(), [dataSource()]);

    expect(s.flags).toEqual([]);
    expect(s.riskScore).toBe(0);
    expect(s.grade).toBe('A');
    expect(category(s, 'Determinism').score).toBe(100);
    expect(category(s, 'Performance').score).toBe(100);
  });

  it('treats full-text search as critical, because it is a fatal-panic source', () => {
    const s = buildScorecard(manifest({ features: ['fullTextSearch'] }), [dataSource()]);

    expect(titles(s)).toContain('Full-text search enabled');
    expect(s.flags.find((f) => f.title === 'Full-text search enabled')!.level).toBe('critical');
    expect(s.riskScore).toBe(30);
    expect(category(s, 'Determinism').score).toBe(55);
    expect(category(s, 'Determinism').note).toMatch(/Non-deterministic/);
  });

  it('flags ipfs reachability from a handler', () => {
    const s = buildScorecard(manifest(), [
      dataSource({ handlers: [handler({ categories: ['ipfs'] })] }),
    ]);

    const flag = s.flags.find((f) => f.title === 'IPFS / file-data access')!;
    expect(flag.level).toBe('warn');
    expect(flag.detail).toContain('1 handler(s)');
    expect(category(s, 'Determinism').score).toBe(70);
  });

  it('flags ipfs from a manifest feature even with no handler reaching it', () => {
    // The two are different evidence for the same hazard and either is enough.
    const s = buildScorecard(manifest({ features: ['nonDeterministicIpfs'] }), [dataSource()]);
    expect(titles(s)).toContain('IPFS / file-data access');

    const other = buildScorecard(manifest({ features: ['ipfsOnEthereumContracts'] }), [dataSource()]);
    expect(titles(other)).toContain('IPFS / file-data access');
  });

  it('counts eth_call handlers and scales the performance penalty with them', () => {
    const one = buildScorecard(manifest(), [
      dataSource({ handlers: [handler({ categories: ['ethereum'] })] }),
    ]);
    const many = buildScorecard(manifest(), [
      dataSource({
        handlers: Array.from({ length: 5 }, () => handler({ categories: ['ethereum'] })),
      }),
    ]);

    expect(one.flags.find((f) => f.title === 'eth_call in handlers')!.detail).toContain('1 handler');
    expect(many.flags.find((f) => f.title === 'eth_call in handlers')!.detail).toContain('5 handler');
    // More calls, worse performance, but the penalty is capped rather than unbounded.
    expect(category(many, 'Performance').score).toBeLessThan(category(one, 'Performance').score);
    expect(category(many, 'Performance').score).toBeGreaterThanOrEqual(55);
  });

  it('flags block handlers harder than call handlers', () => {
    const block = buildScorecard(manifest(), [
      dataSource({ handlers: [handler({ kind: 'block' })] }),
    ]);
    const call = buildScorecard(manifest(), [
      dataSource({ handlers: [handler({ kind: 'call' })] }),
    ]);

    expect(block.flags[0].level).toBe('warn');
    expect(call.flags[0].level).toBe('info');
    expect(category(block, 'Performance').score).toBeLessThan(category(call, 'Performance').score);
  });

  it('flags a wildcard data source, which indexes every contract', () => {
    const s = buildScorecard(manifest(), [dataSource({ address: null })]);

    expect(titles(s)).toContain('Wildcard indexing');
    expect(category(s, 'Performance').score).toBe(85);
  });

  it('does not call a template wildcard, since templates get their address at runtime', () => {
    // A template with no address is normal, not a signal. Flagging it would cry wolf on every
    // factory pattern in the network.
    const s = buildScorecard(manifest(), [dataSource({ address: null, isTemplate: true })]);
    expect(titles(s)).not.toContain('Wildcard indexing');
  });

  it('does not call a data source wildcard when it has no event handlers', () => {
    const s = buildScorecard(manifest(), [
      dataSource({ address: null, handlers: [handler({ kind: 'block' })] }),
    ]);
    expect(titles(s)).not.toContain('Wildcard indexing');
  });

  it('reports a graft as information, not as a fault', () => {
    const s = buildScorecard(
      manifest({ graft: { base: 'QmBaseDeploymentHashLong', block: 1_234_567 } }),
      [dataSource()],
    );

    const flag = s.flags.find((f) => f.title === 'Grafted deployment')!;
    expect(flag.level).toBe('info');
    expect(flag.detail).toContain('1,234,567');
    expect(category(s, 'Determinism').score).toBe(92);
  });

  it('flags dynamic data sources and non-fatal errors as information', () => {
    const s = buildScorecard(manifest({ features: ['nonFatalErrors'] }), [
      dataSource({ handlers: [handler({ categories: ['dataSource'] })] }),
    ]);

    expect(titles(s)).toContain('Dynamic data sources');
    expect(titles(s)).toContain('Non-fatal errors');
    expect(s.flags.every((f) => f.level === 'info')).toBe(true);
  });

  it('scores transparency on recovered function names', () => {
    const named = buildScorecard(manifest(), [dataSource()]);
    const sparse = buildScorecard(manifest(), [
      dataSource({ wasm: { namedFunctions: 0, incomplete: false } as never }),
    ]);

    expect(category(named, 'Transparency').score).toBe(85);
    expect(category(named, 'Transparency').note).toMatch(/recovered/);
    expect(category(sparse, 'Transparency').score).toBe(55);
    expect(category(sparse, 'Transparency').note).toMatch(/Sparse/);
  });

  it('docks transparency further when a module could not be fully decoded', () => {
    const s = buildScorecard(manifest(), [
      dataSource({ wasm: { namedFunctions: 10, incomplete: true } as never }),
    ]);
    expect(category(s, 'Transparency').score).toBe(65);
  });

  it('handles a data source whose WASM never loaded', () => {
    // A failed fetch must not throw here; it lands as sparse transparency and nothing else.
    const s = buildScorecard(manifest(), [
      dataSource({ wasm: null, error: 'ipfs timeout', handlers: [] }),
    ]);

    expect(s.flags).toEqual([]);
    expect(category(s, 'Transparency').score).toBe(55);
  });

  it.each([
    [[], 'A'],
    [['nonFatalErrors'], 'A'],
    [['fullTextSearch'], 'C'],
  ])('grades features %s as %s', (features, grade) => {
    expect(buildScorecard(manifest({ features }), [dataSource()]).grade).toBe(grade);
  });

  it('caps the risk score at 100 however many flags pile up', () => {
    const s = buildScorecard(
      manifest({
        features: ['fullTextSearch', 'nonDeterministicIpfs', 'nonFatalErrors'],
        graft: { base: 'QmBase', block: 1 },
      }),
      [
        dataSource({
          address: null,
          handlers: [
            handler({ categories: ['ethereum', 'ipfs', 'dataSource'] }),
            handler({ kind: 'block' }),
            handler({ kind: 'call' }),
          ],
        }),
      ],
    );

    expect(s.riskScore).toBeLessThanOrEqual(100);
    expect(s.grade).toBe('F');
    // Scores are floors as well as caps: nothing may go negative.
    for (const c of s.categories) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(100);
    }
  });

  it('counts handlers across every data source, not just the first', () => {
    const s = buildScorecard(manifest(), [
      dataSource({ name: 'A', handlers: [handler({ categories: ['ethereum'] })] }),
      dataSource({ name: 'B', handlers: [handler({ categories: ['ethereum'] })] }),
    ]);
    expect(s.flags.find((f) => f.title === 'eth_call in handlers')!.detail).toContain('2 handler');
  });

  it('always returns the three named categories, in order', () => {
    const s = buildScorecard(manifest(), []);
    expect(s.categories.map((c) => c.name)).toEqual([
      'Determinism',
      'Performance',
      'Transparency',
    ]);
  });
});
