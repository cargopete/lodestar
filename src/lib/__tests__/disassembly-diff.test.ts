import { describe, it, expect } from 'vitest';
import { diffReports } from '../disassembly/diff';
import type {
  DisassemblyReport,
  HandlerAnalysis,
  HostCategory,
  DataSourceReport,
  Scorecard,
  RiskFlag,
} from '../disassembly/types';

function handler(overrides: Partial<HandlerAnalysis> = {}): HandlerAnalysis {
  return {
    handler: 'handleTransfer',
    kind: 'event',
    trigger: 'Transfer(address,address,uint256)',
    resolved: true,
    hostImports: [],
    categories: ['store'],
    dynamicDispatch: false,
    incomplete: false,
    ...overrides,
  };
}

function dataSource(name: string, handlers: HandlerAnalysis[]): DataSourceReport {
  return {
    name,
    kind: 'ethereum/contract',
    isTemplate: false,
    network: 'mainnet',
    address: '0xabc',
    startBlock: 0,
    apiVersion: '0.0.7',
    wasmHash: 'Qmwasm',
    wasm: {
      wasmHash: 'Qmwasm',
      byteSize: 1000,
      functionCount: 10,
      importedFunctionCount: 5,
      definedFunctionCount: 5,
      hostImports: [],
      otherImportCount: 0,
      strings: [],
      namedFunctions: 0,
      incomplete: false,
      notes: [],
    },
    handlers,
    abis: [],
    error: null,
  };
}

function scorecard(overrides: Partial<Scorecard> = {}): Scorecard {
  return {
    grade: 'A',
    riskScore: 10,
    flags: [],
    categories: [],
    ...overrides,
  };
}

function report(overrides: Partial<DisassemblyReport> = {}): DisassemblyReport {
  const dataSources = overrides.dataSources ?? [dataSource('Token', [handler()])];
  const hostCategories = [
    ...new Set(dataSources.flatMap((d) => d.handlers.flatMap((h) => h.categories))),
  ].sort() as HostCategory[];
  return {
    deploymentId: 'QmBase',
    manifest: {
      specVersion: '0.0.5',
      apiVersions: ['0.0.7'],
      network: 'mainnet',
      features: [],
      schemaHash: 'Qmschema',
      graft: null,
    },
    dataSources,
    scorecard: scorecard(),
    totals: {
      dataSources: dataSources.filter((d) => !d.isTemplate).length,
      templates: 0,
      handlers: dataSources.reduce((s, d) => s + d.handlers.length, 0),
      resolvedHandlers: dataSources.reduce((s, d) => s + d.handlers.filter((h) => h.resolved).length, 0),
      wasmBytes: 1000,
      hostCategories,
    },
    caveats: [],
    ...overrides,
  };
}

describe('diffReports', () => {
  it('reports identical when nothing material changed', () => {
    const d = diffReports(report(), report({ deploymentId: 'QmTarget' }));
    expect(d.identical).toBe(true);
    expect(d.summary).toEqual({
      handlersAdded: 0,
      handlersRemoved: 0,
      handlersChanged: 0,
      handlersUnchanged: 1,
    });
  });

  it('detects an added handler', () => {
    const base = report({ dataSources: [dataSource('Token', [handler()])] });
    const target = report({
      deploymentId: 'QmTarget',
      dataSources: [dataSource('Token', [handler(), handler({ handler: 'handleApproval' })])],
    });
    const d = diffReports(base, target);
    expect(d.identical).toBe(false);
    expect(d.summary.handlersAdded).toBe(1);
    const added = d.handlers.find((h) => h.handler === 'handleApproval');
    expect(added?.status).toBe('added');
    expect(added?.categoriesAdded).toEqual(['store']);
  });

  it('detects a removed handler', () => {
    const base = report({
      dataSources: [dataSource('Token', [handler(), handler({ handler: 'handleApproval' })])],
    });
    const target = report({ deploymentId: 'QmTarget', dataSources: [dataSource('Token', [handler()])] });
    const d = diffReports(base, target);
    expect(d.summary.handlersRemoved).toBe(1);
    expect(d.handlers.find((h) => h.handler === 'handleApproval')?.status).toBe('removed');
  });

  it('detects a handler that gained an eth_call (the headline case)', () => {
    const base = report({ dataSources: [dataSource('Token', [handler({ categories: ['store'] })])] });
    const target = report({
      deploymentId: 'QmTarget',
      dataSources: [dataSource('Token', [handler({ categories: ['store', 'ethereum'] })])],
    });
    const d = diffReports(base, target);
    expect(d.summary.handlersChanged).toBe(1);
    const changed = d.handlers.find((h) => h.handler === 'handleTransfer');
    expect(changed?.status).toBe('changed');
    expect(changed?.categoriesAdded).toEqual(['ethereum']);
    expect(changed?.categoriesRemoved).toEqual([]);
    expect(d.hostSurface.added).toContain('ethereum');
  });

  it('captures scorecard grade and risk movement', () => {
    const flagA: RiskFlag = { level: 'warn', title: 'eth_call hotspot', detail: '...' };
    const base = report({ scorecard: scorecard({ grade: 'A', riskScore: 10, flags: [] }) });
    const target = report({
      deploymentId: 'QmTarget',
      scorecard: scorecard({ grade: 'C', riskScore: 45, flags: [flagA] }),
    });
    const d = diffReports(base, target);
    expect(d.scorecard.gradeFrom).toBe('A');
    expect(d.scorecard.gradeTo).toBe('C');
    expect(d.scorecard.riskDelta).toBe(35);
    expect(d.scorecard.flagsAdded.map((f) => f.title)).toEqual(['eth_call hotspot']);
    expect(d.scorecard.flagsRemoved).toEqual([]);
  });

  it('detects apiVersion changes in the manifest', () => {
    const base = report();
    const target = report({
      deploymentId: 'QmTarget',
      manifest: { ...report().manifest, apiVersions: ['0.0.9'] },
    });
    const d = diffReports(base, target);
    expect(d.manifest.apiVersionChanged).toBe(true);
    expect(d.manifest.apiVersionsFrom).toEqual(['0.0.7']);
    expect(d.manifest.apiVersionsTo).toEqual(['0.0.9']);
    expect(d.identical).toBe(false);
  });

  it('diffs recovered strings and orders handlers changed→added→removed→unchanged', () => {
    const base = report({
      dataSources: [
        {
          ...dataSource('Token', [handler({ categories: ['store'] })]),
          wasm: { ...dataSource('Token', []).wasm!, strings: ['Transfer', 'Account'] },
        },
      ],
    });
    const target = report({
      deploymentId: 'QmTarget',
      dataSources: [
        {
          ...dataSource('Token', [
            handler({ categories: ['store', 'ipfs'] }),
            handler({ handler: 'handleApproval' }),
          ]),
          wasm: { ...dataSource('Token', []).wasm!, strings: ['Transfer', 'Approval'] },
        },
      ],
    });
    const d = diffReports(base, target);
    expect(d.strings.added).toEqual(['Approval']);
    expect(d.strings.removed).toEqual(['Account']);
    // ordering: changed first, then added
    expect(d.handlers[0].status).toBe('changed');
    expect(d.handlers[1].status).toBe('added');
  });
});
