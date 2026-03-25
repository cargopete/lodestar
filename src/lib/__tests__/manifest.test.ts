import { describe, it, expect } from 'vitest';
import { parseManifest } from '../manifest';

function makeManifestYaml(overrides: {
  specVersion?: string;
  features?: string[];
  dataSources?: Array<{
    name?: string;
    kind?: string;
    network?: string;
    address?: string | null;
    startBlock?: number;
    eventHandlers?: number;
    callHandlers?: number;
    blockHandlers?: number;
  }>;
  templates?: Array<{
    name?: string;
    kind?: string;
    network?: string;
    eventHandlers?: number;
    callHandlers?: number;
    blockHandlers?: number;
  }>;
  graft?: { base: string; block: number } | null;
  pruning?: string | null;
} = {}): string {
  const {
    specVersion = '0.0.5',
    features = [],
    dataSources = [{ name: 'Factory', startBlock: 12369621 }],
    templates = [],
    graft = null,
    pruning = null,
  } = overrides;

  const ds = dataSources.map(d => {
    const eventHandlers = Array.from({ length: d.eventHandlers ?? 2 }, (_, i) => `        - event: Event${i}\n          handler: handleEvent${i}`);
    const callHandlers = d.callHandlers ? Array.from({ length: d.callHandlers }, (_, i) => `        - function: func${i}\n          handler: handleFunc${i}`) : [];
    const blockHandlers = d.blockHandlers ? Array.from({ length: d.blockHandlers }, (_, i) => `        - handler: handleBlock${i}`) : [];

    return `  - name: ${d.name ?? 'Source'}
    kind: ${d.kind ?? 'ethereum/contract'}
    network: ${d.network ?? 'mainnet'}
    source:
      ${d.address !== null ? `address: "${d.address ?? '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'}"` : '# no address'}
      startBlock: ${d.startBlock ?? 12369621}
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
${eventHandlers.length > 0 ? `      eventHandlers:\n${eventHandlers.join('\n')}` : ''}
${callHandlers.length > 0 ? `      callHandlers:\n${callHandlers.join('\n')}` : ''}
${blockHandlers.length > 0 ? `      blockHandlers:\n${blockHandlers.join('\n')}` : ''}`;
  });

  const tpls = templates.map(t => {
    const eventHandlers = Array.from({ length: t.eventHandlers ?? 2 }, (_, i) => `        - event: Event${i}\n          handler: handleEvent${i}`);
    const callHandlers = t.callHandlers ? Array.from({ length: t.callHandlers }, (_, i) => `        - function: func${i}\n          handler: handleFunc${i}`) : [];
    const blockHandlers = t.blockHandlers ? Array.from({ length: t.blockHandlers }, (_, i) => `        - handler: handleBlock${i}`) : [];

    return `  - name: ${t.name ?? 'Template'}
    kind: ${t.kind ?? 'ethereum/contract'}
    network: ${t.network ?? 'mainnet'}
    source:
      abi: SomeABI
    mapping:
      kind: ethereum/events
${eventHandlers.length > 0 ? `      eventHandlers:\n${eventHandlers.join('\n')}` : ''}
${callHandlers.length > 0 ? `      callHandlers:\n${callHandlers.join('\n')}` : ''}
${blockHandlers.length > 0 ? `      blockHandlers:\n${blockHandlers.join('\n')}` : ''}`;
  });

  let yaml = `specVersion: ${specVersion}\n`;
  if (features.length > 0) yaml += `features:\n${features.map(f => `  - ${f}`).join('\n')}\n`;
  yaml += `dataSources:\n${ds.join('\n')}\n`;
  if (tpls.length > 0) yaml += `templates:\n${tpls.join('\n')}\n`;
  if (graft) yaml += `graft:\n  base: ${graft.base}\n  block: ${graft.block}\n`;
  if (pruning) yaml += `indexerHints:\n  prune: ${pruning}\n`;

  return yaml;
}

// ---------- Basic parsing ----------

describe('parseManifest basic parsing', () => {
  it('parses specVersion', () => {
    const result = parseManifest(makeManifestYaml({ specVersion: '0.0.7' }));
    expect(result.specVersion).toBe('0.0.7');
  });

  it('parses data sources', () => {
    const result = parseManifest(makeManifestYaml({
      dataSources: [
        { name: 'Factory', startBlock: 12369621, eventHandlers: 3 },
        { name: 'Router', startBlock: 15000000, eventHandlers: 2 },
      ],
    }));
    expect(result.dataSources).toHaveLength(2);
    expect(result.dataSources[0].name).toBe('Factory');
    expect(result.dataSources[0].startBlock).toBe(12369621);
    expect(result.dataSources[0].eventHandlers).toBe(3);
    expect(result.dataSources[1].name).toBe('Router');
  });

  it('parses templates', () => {
    const result = parseManifest(makeManifestYaml({
      templates: [{ name: 'Pool', eventHandlers: 5 }],
    }));
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0].name).toBe('Pool');
    expect(result.templates[0].eventHandlers).toBe(5);
  });

  it('parses features', () => {
    const result = parseManifest(makeManifestYaml({
      features: ['fullTextSearch', 'ipfsOnEthereumContracts'],
    }));
    expect(result.features).toEqual(['fullTextSearch', 'ipfsOnEthereumContracts']);
  });

  it('detects graft config', () => {
    const result = parseManifest(makeManifestYaml({
      graft: { base: 'QmBaseDeployment', block: 15000000 },
    }));
    expect(result.graft).toEqual({ base: 'QmBaseDeployment', block: 15000000 });
  });

  it('detects pruning config', () => {
    const result = parseManifest(makeManifestYaml({ pruning: 'auto' }));
    expect(result.pruning).toBe('auto');
  });

  it('detects network', () => {
    const result = parseManifest(makeManifestYaml({
      dataSources: [{ network: 'arbitrum-one', startBlock: 1000 }],
    }));
    expect(result.network).toBe('arbitrum-one');
  });

  it('returns null for no graft', () => {
    const result = parseManifest(makeManifestYaml());
    expect(result.graft).toBeNull();
  });

  it('returns null for no pruning', () => {
    const result = parseManifest(makeManifestYaml());
    expect(result.pruning).toBeNull();
  });
});

// ---------- Complexity categories ----------

describe('complexity categories', () => {
  it('classifies Light (<25)', () => {
    const result = parseManifest(makeManifestYaml({
      dataSources: [{ startBlock: 20_000_000, eventHandlers: 2 }],
    }));
    expect(result.category).toBe('Light');
    expect(result.score).toBeLessThan(25);
  });

  it('classifies Extreme for block handlers with early start', () => {
    const result = parseManifest(makeManifestYaml({
      dataSources: [{ startBlock: 1_000_000, blockHandlers: 1, eventHandlers: 2 }],
    }));
    expect(result.category).toBe('Extreme');
    expect(result.score).toBe(100);
  });

  it('classifies Extreme for missing address + block handlers', () => {
    const result = parseManifest(makeManifestYaml({
      dataSources: [{ address: null, blockHandlers: 1, eventHandlers: 2, startBlock: 20_000_000 }],
    }));
    expect(result.score).toBe(100);
    expect(result.category).toBe('Extreme');
  });
});

// ---------- Individual scoring dimensions ----------

describe('block range scoring', () => {
  it('scores max (25) for startBlock 0', () => {
    const result = parseManifest(makeManifestYaml({
      dataSources: [{ startBlock: 0, eventHandlers: 1 }],
    }));
    const blockDim = result.breakdown.find(b => b.dimension === 'Block Range');
    expect(blockDim?.score).toBe(25);
  });

  it('scores 0 for very high startBlock (18M+)', () => {
    const result = parseManifest(makeManifestYaml({
      dataSources: [{ startBlock: 20_000_000, eventHandlers: 1 }],
    }));
    const blockDim = result.breakdown.find(b => b.dimension === 'Block Range');
    expect(blockDim?.score).toBe(0);
  });

  it('uses lowest startBlock across sources', () => {
    const result = parseManifest(makeManifestYaml({
      dataSources: [
        { name: 'A', startBlock: 20_000_000, eventHandlers: 1 },
        { name: 'B', startBlock: 100_000, eventHandlers: 1 },
      ],
    }));
    const blockDim = result.breakdown.find(b => b.dimension === 'Block Range');
    expect(blockDim?.score).toBe(22); // < 1M
  });
});

describe('handler types scoring', () => {
  it('scores 0 for events only', () => {
    const result = parseManifest(makeManifestYaml({
      dataSources: [{ startBlock: 20_000_000, eventHandlers: 5 }],
    }));
    const handlerDim = result.breakdown.find(b => b.dimension === 'Handler Types');
    expect(handlerDim?.score).toBe(0);
  });

  it('scores 18 for block handlers', () => {
    const result = parseManifest(makeManifestYaml({
      dataSources: [{ startBlock: 20_000_000, blockHandlers: 1, eventHandlers: 1 }],
    }));
    const handlerDim = result.breakdown.find(b => b.dimension === 'Handler Types');
    expect(handlerDim?.score).toBe(18);
  });

  it('scores 7 for call handlers only', () => {
    const result = parseManifest(makeManifestYaml({
      dataSources: [{ startBlock: 20_000_000, callHandlers: 2, eventHandlers: 1 }],
    }));
    const handlerDim = result.breakdown.find(b => b.dimension === 'Handler Types');
    expect(handlerDim?.score).toBe(7);
  });

  it('scores 25 for both block and call handlers', () => {
    const result = parseManifest(makeManifestYaml({
      dataSources: [{ startBlock: 20_000_000, blockHandlers: 1, callHandlers: 1, eventHandlers: 1 }],
    }));
    const handlerDim = result.breakdown.find(b => b.dimension === 'Handler Types');
    expect(handlerDim?.score).toBe(25);
  });

  it('detects handlers in templates too', () => {
    const result = parseManifest(makeManifestYaml({
      dataSources: [{ startBlock: 20_000_000, eventHandlers: 1 }],
      templates: [{ blockHandlers: 1, eventHandlers: 1 }],
    }));
    const handlerDim = result.breakdown.find(b => b.dimension === 'Handler Types');
    expect(handlerDim?.score).toBe(18);
  });
});

describe('data source count scoring', () => {
  it('scores 0 for 1-2 sources', () => {
    const result = parseManifest(makeManifestYaml({
      dataSources: [{ startBlock: 20_000_000 }],
    }));
    const dsDim = result.breakdown.find(b => b.dimension === 'Data Sources');
    expect(dsDim?.score).toBe(0);
  });

  it('scores 10 for 11+ sources', () => {
    const sources = Array.from({ length: 12 }, (_, i) => ({
      name: `Source${i}`, startBlock: 20_000_000, eventHandlers: 1,
    }));
    const result = parseManifest(makeManifestYaml({ dataSources: sources }));
    const dsDim = result.breakdown.find(b => b.dimension === 'Data Sources');
    expect(dsDim?.score).toBe(10);
  });
});

describe('template scoring', () => {
  it('scores 0 for no templates', () => {
    const result = parseManifest(makeManifestYaml());
    const tplDim = result.breakdown.find(b => b.dimension === 'Templates');
    expect(tplDim?.score).toBe(0);
  });

  it('scores 15 for 5+ templates', () => {
    const templates = Array.from({ length: 5 }, (_, i) => ({
      name: `Tpl${i}`, eventHandlers: 1,
    }));
    const result = parseManifest(makeManifestYaml({ templates }));
    const tplDim = result.breakdown.find(b => b.dimension === 'Templates');
    expect(tplDim?.score).toBe(15);
  });
});

describe('features scoring', () => {
  it('scores 0 for no heavy features', () => {
    const result = parseManifest(makeManifestYaml({ features: [] }));
    const featDim = result.breakdown.find(b => b.dimension === 'Features');
    expect(featDim?.score).toBe(0);
  });

  it('scores for heavy features up to max 5', () => {
    const result = parseManifest(makeManifestYaml({
      features: ['fullTextSearch', 'ipfsOnEthereumContracts', 'nonDeterministicIpfs'],
    }));
    const featDim = result.breakdown.find(b => b.dimension === 'Features');
    expect(featDim?.score).toBe(5); // 3 * 2 = 6, capped at 5
  });
});

describe('pruning scoring', () => {
  it('scores 0 for auto pruning', () => {
    const result = parseManifest(makeManifestYaml({ pruning: 'auto' }));
    const pruneDim = result.breakdown.find(b => b.dimension === 'Pruning');
    expect(pruneDim?.score).toBe(0);
  });

  it('scores 5 for absent pruning', () => {
    const result = parseManifest(makeManifestYaml());
    const pruneDim = result.breakdown.find(b => b.dimension === 'Pruning');
    expect(pruneDim?.score).toBe(5);
  });
});

describe('graft scoring', () => {
  it('scores 0 for no graft', () => {
    const result = parseManifest(makeManifestYaml());
    const graftDim = result.breakdown.find(b => b.dimension === 'Graft');
    expect(graftDim?.score).toBe(0);
  });

  it('scores 5 for graft present', () => {
    const result = parseManifest(makeManifestYaml({
      graft: { base: 'QmBase', block: 15000000 },
    }));
    const graftDim = result.breakdown.find(b => b.dimension === 'Graft');
    expect(graftDim?.score).toBe(5);
  });
});

// ---------- Score capping ----------

describe('score capping', () => {
  it('caps at 100', () => {
    const result = parseManifest(makeManifestYaml({
      dataSources: [{ startBlock: 0, blockHandlers: 1, callHandlers: 1, eventHandlers: 10, address: null }],
      templates: Array.from({ length: 6 }, () => ({ eventHandlers: 1 })),
      features: ['fullTextSearch', 'ipfsOnEthereumContracts', 'nonDeterministicIpfs'],
      graft: { base: 'QmBase', block: 100 },
    }));
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
