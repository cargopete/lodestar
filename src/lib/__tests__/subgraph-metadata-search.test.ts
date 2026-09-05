/**
 * The search finders and the manifest reader in `subgraph-metadata` (nightswatchhq/nuthatch#1160,
 * group B). Pinned here: a name search goes Postgres cache -> graph-gns-nest `subgraph_current`
 * (deprecated excluded) -> `lodestar_deployments` figures, ordered by signal and capped; an address
 * search reads the manifest text column; a hash-prefix search filters the deployment ids as CIDs;
 * `manifestFacts` reads network and substreams off YAML; `deploymentRowToApi` builds the page shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbRows = vi.fn();
vi.mock('../db', () => ({
  hasDbAccess: () => true,
  db: Object.assign((strings: TemplateStringsArray, ...vals: unknown[]) => dbRows(strings.join('?'), vals), {}),
}));
vi.mock('../cache', () => ({ cached: vi.fn((_k: string, _t: number, f: () => Promise<unknown>) => f()) }));
const nuthatchSql = vi.fn();
vi.mock('../nuthatch', () => ({ nuthatchSql: (...a: unknown[]) => nuthatchSql(...a) }));
vi.mock('../logger', () => ({ log: { api: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } }));

import { searchSubgraphsByName, searchDeploymentsByManifestAddress, searchDeploymentsByHashPrefix, manifestFacts, deploymentRowToApi } from '../subgraph-metadata';
import { ipfsHashToBytes32, bytes32ToIpfsHash } from '../studio/ipfs';

const META_CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const META_ID = ipfsHashToBytes32(META_CID).toLowerCase();
const DEP_A = '0x' + 'a'.repeat(64);
const DEP_B = '0x' + 'b'.repeat(64);

beforeEach(() => vi.clearAllMocks());

describe('searchSubgraphsByName', () => {
  it('Postgres names -> live subgraphs on gns -> figures on alloc, by signal, capped', async () => {
    dbRows.mockResolvedValue([{ cid: META_CID }]);
    nuthatchSql.mockImplementation(async (sql: string, base: string) => {
      if (sql.includes('FROM subgraph_current')) {
        expect(base).toBe('/gns');
        expect(sql).toContain('NOT deprecated');
        expect(sql).toContain(`'${META_ID}'`);
        return [{ subgraph_id: '7', current_deployment_id: DEP_A, subgraph_metadata: META_ID }, { subgraph_id: '8', current_deployment_id: DEP_B, subgraph_metadata: META_ID }];
      }
      if (sql.includes('FROM lodestar_deployments')) {
        expect(base).toBe('/alloc');
        return [{ id: DEP_A, signalled_tokens: '10', staked_tokens: '1' }, { id: DEP_B, signalled_tokens: '50', staked_tokens: '2' }];
      }
      if (sql.includes('FROM deployment_subgraphs')) {
        return [{ deployment_id: DEP_A, subgraph_id: '7', subgraph_metadata: META_ID, version_metadata: null, is_current: true, version_number: 0, deprecated: false },
                { deployment_id: DEP_B, subgraph_id: '8', subgraph_metadata: META_ID, version_metadata: null, is_current: true, version_number: 0, deprecated: false }];
      }
      throw new Error(`unexpected sql: ${sql}`);
    });
    // the metadata document itself is served from the Postgres cache
    dbRows.mockImplementation(async (q: string) => q.includes('ILIKE') ? [{ cid: META_CID }] : [{ json: { displayName: 'Uniswap v3', description: 'swaps' }, error: null, fetched_at: new Date() }]);
    const hits = await searchSubgraphsByName('uniswap', 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({ id: '8', metadata: { displayName: 'Uniswap v3', description: 'swaps' }, currentVersion: { subgraphDeployment: { ipfsHash: bytes32ToIpfsHash(DEP_B), signalledTokens: '50', stakedTokens: '2' } } });
    expect(dbRows.mock.calls[0][0]).toContain("json->>'displayName' ILIKE");
    expect(dbRows.mock.calls[0][1]).toEqual(['%uniswap%']);
  });

  it('no cached name matches: nothing is asked of either nest', async () => {
    dbRows.mockResolvedValue([]);
    expect(await searchSubgraphsByName('zzz')).toEqual([]);
    expect(nuthatchSql).not.toHaveBeenCalled();
  });
});

describe('searchDeploymentsByManifestAddress', () => {
  it('reads the manifest text column and resolves the CIDs to deployments', async () => {
    const depCid = bytes32ToIpfsHash(DEP_A);
    dbRows.mockImplementation(async (q: string) => q.includes('text ILIKE') ? [{ cid: depCid }] : []);
    nuthatchSql.mockImplementation(async (sql: string) => sql.includes('FROM lodestar_deployments') ? [{ id: DEP_A, signalled_tokens: '3', staked_tokens: '4' }] : []);
    const hits = await searchDeploymentsByManifestAddress('0x6f9bb7e454f5b3eb2310343f0e99269dc2bb8a1d');
    expect(hits).toHaveLength(1);
    expect(hits[0].currentVersion?.subgraphDeployment).toEqual({ ipfsHash: depCid, signalledTokens: '3', stakedTokens: '4' });
    expect(hits[0].metadata).toBeNull();
    expect(dbRows.mock.calls[0][1]).toEqual(['%0x6f9bb7e454f5b3eb2310343f0e99269dc2bb8a1d%']);
  });
});

describe('searchDeploymentsByHashPrefix', () => {
  it('filters every signalled or staked deployment by its CID prefix', async () => {
    const want = bytes32ToIpfsHash(DEP_A);
    nuthatchSql.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT id FROM lodestar_deployments')) return [{ id: DEP_A }, { id: DEP_B }];
      if (sql.includes('FROM lodestar_deployments')) return [{ id: DEP_A, signalled_tokens: '1', staked_tokens: '0' }];
      return [];
    });
    dbRows.mockResolvedValue([]);
    const hits = await searchDeploymentsByHashPrefix(want.slice(0, 10));
    expect(hits.map((h) => h.currentVersion?.subgraphDeployment.ipfsHash)).toEqual([want]);
  });
});

describe('manifestFacts and deploymentRowToApi', () => {
  it('reads the network and a substreams data source off a manifest', () => {
    expect(manifestFacts('specVersion: 1.0.0\ndataSources:\n  - kind: ethereum/contract\n    network: arbitrum-one\n')).toEqual({ network: 'arbitrum-one', poweredBySubstreams: false });
    expect(manifestFacts('dataSources:\n  - kind: substreams\n    network: mainnet\n')).toEqual({ network: 'mainnet', poweredBySubstreams: true });
    expect(manifestFacts(null)).toEqual({ network: null, poweredBySubstreams: false });
  });
  it('builds the page shape with counted arrays', () => {
    const out = deploymentRowToApi({ id: DEP_A, signalled_tokens: '1', staked_tokens: '2', query_fees_amount: '3', created_at: '1700000000', active_allocation_count: '2', curator_count: 0 }, { displayName: null, categories: [] });
    expect(out).toMatchObject({ id: DEP_A, ipfsHash: bytes32ToIpfsHash(DEP_A), signalledTokens: '1', createdAt: 1700000000, displayName: null, categories: [] });
    expect(out.indexerAllocations).toHaveLength(2);
    expect(out.curatorSignals).toEqual([]);
  });
});
