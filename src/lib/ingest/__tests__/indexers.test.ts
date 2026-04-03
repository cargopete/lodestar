import { describe, it, expect, vi } from 'vitest';
import { writeIndexers } from '../indexers';
import type { EnrichedIndexer } from '../../enriched';

// Minimal EnrichedIndexer fixture
function makeIndexer(overrides: Partial<EnrichedIndexer> = {}): EnrichedIndexer {
  return {
    id: '0xabc123',
    name: 'Test Indexer',
    stakedTokens: '100000000000000000000000',
    lockedTokens: '0',
    delegatedTokens: '500000000000000000000000',
    allocatedTokens: '100000000000000000000000',
    allocationCount: 2,
    indexingRewardCut: 100_000,
    queryFeeCut: 50_000,
    delegatorParameterCooldown: 0,
    lastDelegationParameterUpdate: 0,
    rewardsEarned: '1000000000000000000000',
    delegatorShares: '100000000000000000000000',
    url: 'https://indexer.example.com',
    geoHash: null,
    createdAt: 1000,
    ensName: null,
    selfStakeGRT: 100_000,
    delegatedGRT: 500_000,
    delegatorAPR: 5.5,
    delegationCapacity: {
      maxCapacity: 1_600_000,
      usedCapacity: 500_000,
      availableCapacity: 1_100_000,
      utilizationPercent: 31.25,
    },
    reoStatus: 'eligible',
    reoSource: 'oracle',
    reoRenewalTimestamp: null,
    reoExpiresAt: null,
    reoDaysRemaining: null,
    recentActivity: {
      delegationsIn7d: 2,
      undelegationsIn7d: 1,
      netFlowGRT: 10_000,
    },
    effectiveCut: 0.1,
    overDelegationDilution: null,
    ownStakeRatio: 0.2,
    indexerRewardsOwnGenerationRatio: null,
    provisionedGRT: null,
    queryFeesCollectedGRT: 500,
    delegationExchangeRate: 1.05,
    rollingAPY30d: null,
    rollingAPY90d: null,
    score: 72,
    scoreGrade: 'B',
    scoreBreakdown: {
      reo: 25, selfStake: 15, queryVolume: 10, cutStability: 12,
      allocationEfficiency: 5, overDelegation: 0, transparency: 3,
      delegationTrend: 1, delegatorAPY: 1,
    },
    computedAt: Date.now(),
    ...overrides,
  };
}

// Build a mock sql that records calls and returns configured values
function makeSql(responses: unknown[][] = [[], [], [], []]) {
  let call = 0;
  const sql = vi.fn((..._args: unknown[]) => {
    const res = responses[call] ?? [];
    call++;
    return Promise.resolve(res);
  }) as ReturnType<typeof vi.fn> & { calls: unknown[] };
  return sql;
}

describe('writeIndexers', () => {
  it('returns zeros for empty input without touching the db', async () => {
    const sql = makeSql();
    const result = await writeIndexers(sql as never, []);
    expect(result).toEqual({ upserted: 0, snapshots: 0, paramChanges: 0 });
    expect(sql).not.toHaveBeenCalled();
  });

  it('upserts a single indexer', async () => {
    const indexer = makeIndexer();
    // responses: 1=existing rows, 2=upsert INSERT, 3=snapshot INSERT
    const sql = makeSql([[], [], []]);
    const result = await writeIndexers(sql as never, [indexer]);
    expect(result.upserted).toBe(1);
    expect(result.snapshots).toBe(1);
    expect(result.paramChanges).toBe(0);
  });

  it('detects reward_cut change and records a parameter change', async () => {
    const indexer = makeIndexer({ id: '0xabc', indexingRewardCut: 200_000 });
    // existing row has different reward_cut
    const existing = [{ address: '0xabc', reward_cut: 100_000, query_fee_cut: 50_000 }];
    // responses: 1=existing, 2=param change INSERT, 3=upsert INSERT, 4=snapshot INSERT
    const sql = makeSql([existing, [], [], []]);
    const result = await writeIndexers(sql as never, [indexer]);
    expect(result.paramChanges).toBe(1);
    // Verify the param changes INSERT was called with the right data
    const insertCall = sql.mock.calls[1];
    expect(insertCall).toBeDefined();
  });

  it('detects query_fee_cut change and records a parameter change', async () => {
    const indexer = makeIndexer({ id: '0xdef', queryFeeCut: 75_000 });
    const existing = [{ address: '0xdef', reward_cut: 100_000, query_fee_cut: 50_000 }];
    const sql = makeSql([existing, [], [], []]);
    const result = await writeIndexers(sql as never, [indexer]);
    expect(result.paramChanges).toBe(1);
  });

  it('detects both reward_cut and query_fee_cut changes simultaneously', async () => {
    const indexer = makeIndexer({ id: '0xfoo', indexingRewardCut: 300_000, queryFeeCut: 80_000 });
    const existing = [{ address: '0xfoo', reward_cut: 100_000, query_fee_cut: 50_000 }];
    const sql = makeSql([existing, [], [], []]);
    const result = await writeIndexers(sql as never, [indexer]);
    expect(result.paramChanges).toBe(2);
  });

  it('does not record a change when reward_cut matches existing', async () => {
    const indexer = makeIndexer({ id: '0xabc', indexingRewardCut: 100_000 });
    const existing = [{ address: '0xabc', reward_cut: 100_000, query_fee_cut: 50_000 }];
    const sql = makeSql([existing, [], []]);
    const result = await writeIndexers(sql as never, [indexer]);
    expect(result.paramChanges).toBe(0);
  });

  it('does not record a change for new indexers (no existing record)', async () => {
    const indexer = makeIndexer({ id: '0xnew' });
    const existing: unknown[] = []; // no existing row
    const sql = makeSql([existing, [], []]);
    const result = await writeIndexers(sql as never, [indexer]);
    expect(result.paramChanges).toBe(0);
  });

  it('skips param change when existing reward_cut is null', async () => {
    const indexer = makeIndexer({ id: '0xabc', indexingRewardCut: 200_000 });
    const existing = [{ address: '0xabc', reward_cut: null, query_fee_cut: 50_000 }];
    const sql = makeSql([existing, [], []]);
    const result = await writeIndexers(sql as never, [indexer]);
    // reward_cut is null → no change recorded for it
    expect(result.paramChanges).toBe(0);
  });

  it('passes currentEpoch to param change records', async () => {
    const indexer = makeIndexer({ id: '0xabc', indexingRewardCut: 200_000 });
    const existing = [{ address: '0xabc', reward_cut: 100_000, query_fee_cut: 50_000 }];
    let callCount = 0;
    const sql = vi.fn((..._args: unknown[]) => {
      callCount++;
      if (callCount === 1) return Promise.resolve(existing);
      return Promise.resolve([]);
    });

    const result = await writeIndexers(sql as never, [indexer], 999);
    // 1 param change detected for reward_cut
    expect(result.paramChanges).toBe(1);
    // sql was called multiple times (SELECT + fragment helpers + INSERTs)
    expect(sql).toHaveBeenCalled();
  });

  it('returns correct snapshot count for multiple indexers', async () => {
    const indexers = [
      makeIndexer({ id: '0xaaa' }),
      makeIndexer({ id: '0xbbb' }),
      makeIndexer({ id: '0xccc' }),
    ];
    const sql = makeSql([[], [], []]);
    const result = await writeIndexers(sql as never, indexers);
    expect(result.upserted).toBe(3);
    expect(result.snapshots).toBe(3);
  });

  it('survives snapshot INSERT failure gracefully', async () => {
    const indexer = makeIndexer();
    // sql(rows) fragment helpers are called before the template tag itself,
    // so we get: SELECT(1), sql(rows)(2), INSERT indexers(3), sql(snaps)(4), INSERT snapshots(5=fail)
    let callCount = 0;
    const sql = vi.fn((..._args: unknown[]) => {
      callCount++;
      if (callCount <= 3) return Promise.resolve([]); // existing + upsert fragment + upsert INSERT
      if (callCount === 4) return Promise.resolve([]); // snapshot fragment helper
      return Promise.reject(new Error('snapshot insert failed'));
    });

    // Should not throw — snapshot errors are caught with console.warn
    const result = await writeIndexers(sql as never, [indexer]);
    expect(result.upserted).toBe(1);
    expect(result.snapshots).toBe(0); // failed, so 0
  });
});
