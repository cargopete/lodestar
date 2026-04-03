import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeMonthlyScores } from '../compute';

// Build a minimal mock sql function that returns values from a queue
function makeSql(responses: unknown[][]): ReturnType<typeof vi.fn> {
  let call = 0;
  const fn = vi.fn((..._args: unknown[]) => {
    const res = responses[call] ?? [];
    call++;
    return Promise.resolve(res);
  });
  // Postgres.js sql is also used as sql(rows) for INSERT — handle that too
  (fn as unknown as Record<string, unknown>).unsafe = vi.fn(() => Promise.resolve([]));
  return fn;
}

const baseIndexer = {
  address: '0xabc',
  self_stake_grt: 200_000,
  delegated_grt: 500_000,
  delegator_apr: 5,
  effective_cut: 100_000,
  delegation_capacity_pct: 50,
  reo_status: 'eligible',
  created_at_epoch: Math.floor((Date.now() - 20 * 30 * 24 * 3600 * 1000) / 1000), // 20 months ago
  allocation_count: 3,
};

// Minimal 11-response sequence for a single indexer, no penalties
function makeResponses(indexer = baseIndexer) {
  return [
    [indexer],             // 1. allIndexers
    [{ indexer_address: indexer.address, fees: 1000 }], // 2. feeRows
    [{ indexer_address: indexer.address, efficiency: 0.001 }], // 3. effRows
    [],                    // 4. cutChanges
    [{ indexer_address: indexer.address, net_flow: 50_000 }], // 5. flowRows
    [{ indexer_address: indexer.address, cnt: 10 }], // 6. breadthRows
    [],                    // 7. disputeRows
    [{ indexer_address: indexer.address, fees: 500 }], // 8. fees30dRows
    [],                    // 9. voteTallyRows
    [],                    // 10. DELETE
    [],                    // 11. INSERT
  ];
}

describe('computeMonthlyScores', () => {
  it('returns empty result when no indexers exist', async () => {
    const sql = makeSql([[]]); // allIndexers returns empty
    const result = await computeMonthlyScores(sql as never, { year: 2026, month: 1 });
    expect(result.scored).toBe(0);
    expect(result.entries).toHaveLength(0);
  });

  it('returns scored entries for a single indexer', async () => {
    const sql = makeSql(makeResponses());
    const result = await computeMonthlyScores(sql as never, { year: 2026, month: 1 });
    expect(result.scored).toBe(1);
    expect(result.entries).toHaveLength(1);
  });

  it('sets period_type to monthly', async () => {
    const sql = makeSql(makeResponses());
    const result = await computeMonthlyScores(sql as never, { year: 2026, month: 4 });
    expect(result.entries[0].period_type).toBe('monthly');
  });

  it('sets correct period_start and period_end', async () => {
    const sql = makeSql(makeResponses());
    const result = await computeMonthlyScores(sql as never, { year: 2026, month: 4 });
    expect(result.entries[0].period_start).toBe('2026-04-01');
    expect(result.entries[0].period_end).toBe('2026-05-01');
  });

  it('handles December → January year rollover', async () => {
    const sql = makeSql(makeResponses());
    const result = await computeMonthlyScores(sql as never, { year: 2025, month: 12 });
    expect(result.entries[0].period_start).toBe('2025-12-01');
    expect(result.entries[0].period_end).toBe('2026-01-01');
  });

  it('final_score is between 0 and 100', async () => {
    const sql = makeSql(makeResponses());
    const result = await computeMonthlyScores(sql as never, { year: 2026, month: 4 });
    const score = result.entries[0].final_score;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('sets rank = 1 for the single indexer', async () => {
    const sql = makeSql(makeResponses());
    const result = await computeMonthlyScores(sql as never, { year: 2026, month: 4 });
    expect((result.entries[0] as Record<string, unknown>).rank).toBe(1);
  });

  it('badges the first-ranked indexer', async () => {
    const sql = makeSql(makeResponses());
    const result = await computeMonthlyScores(sql as never, { year: 2026, month: 4 });
    expect(result.entries[0].is_eligible_for_badge).toBe(true);
  });

  it('excludes blacklisted upgradeindexer address', async () => {
    const blacklisted = {
      ...baseIndexer,
      address: '0xbdfb5ee5a2abf4fc7bb1bd1221067aef7f9de491',
    };
    // allIndexers returns only the blacklisted one
    const sql = makeSql([[blacklisted]]);
    const result = await computeMonthlyScores(sql as never, { year: 2026, month: 4 });
    expect(result.scored).toBe(0);
    expect(result.entries).toHaveLength(0);
  });

  it('scores indexer with zero fees as lower than one with fees', async () => {
    const indexerA = { ...baseIndexer, address: '0xaaa', allocation_count: 3 };
    const indexerB = { ...baseIndexer, address: '0xbbb', allocation_count: 3 };

    const sql = makeSql([
      [indexerA, indexerB],                                          // 1. allIndexers
      [{ indexer_address: '0xaaa', fees: 5000 }],                   // 2. feeRows — A has fees
      [{ indexer_address: '0xaaa', efficiency: 0.002 }],            // 3. effRows
      [],                                                             // 4. cutChanges
      [],                                                             // 5. flowRows
      [{ indexer_address: '0xaaa', cnt: 5 }, { indexer_address: '0xbbb', cnt: 3 }], // 6. breadthRows
      [],                                                             // 7. disputeRows
      [{ indexer_address: '0xaaa', fees: 3000 }],                   // 8. fees30dRows — B has 0
      [],                                                             // 9. voteTallyRows
      [],                                                             // 10. DELETE
      [],                                                             // 11. INSERT
    ]);

    const result = await computeMonthlyScores(sql as never, { year: 2026, month: 4 });
    expect(result.scored).toBe(2);
    const [first] = result.entries; // sorted by final_score desc
    expect(first.indexer_address).toBe('0xaaa');
  });

  it('applies community vote score proportionally', async () => {
    const sql = makeSql([
      [baseIndexer],
      [],                              // 2. feeRows
      [],                              // 3. effRows
      [],                              // 4. cutChanges
      [],                              // 5. flowRows
      [],                              // 6. breadthRows
      [],                              // 7. disputeRows
      [],                              // 8. fees30dRows
      [{ indexer_address: '0xabc', weighted_votes: 10 }], // 9. votes
      [],                              // 10. DELETE
      [],                              // 11. INSERT
    ]);

    const result = await computeMonthlyScores(sql as never, { year: 2026, month: 4 });
    // 10 weighted_votes out of max 10 → full 10 community vote score
    expect(result.entries[0].community_vote_score).toBe(10);
  });

  it('applies penalty multiplier for below-min-stake', async () => {
    const poorIndexer = { ...baseIndexer, self_stake_grt: 50_000 }; // below 100K threshold
    const sql = makeSql(makeResponses(poorIndexer));
    const result = await computeMonthlyScores(sql as never, { year: 2026, month: 4 });
    // penalty multiplier < 1.0
    expect(result.entries[0].penalty_multiplier).toBeLessThan(1.0);
  });

  it('applies hasZeroFees penalty when active allocs but zero fees in 30d', async () => {
    const zeroFeeIndexer = { ...baseIndexer, allocation_count: 2 };
    const sql = makeSql([
      [zeroFeeIndexer],
      [],  // 2. feeRows (no fees this month)
      [],  // 3. effRows
      [],  // 4. cutChanges
      [],  // 5. flowRows
      [],  // 6. breadthRows
      [],  // 7. disputeRows
      [],  // 8. fees30dRows (empty → zero fees in 30d)
      [],  // 9. voteTallyRows
      [],  // 10. DELETE
      [],  // 11. INSERT
    ]);

    const result = await computeMonthlyScores(sql as never, { year: 2026, month: 4 });
    // hasZeroFees = true (has active allocs + 0 fees30d) → penalty applied
    expect(result.entries[0].penalty_multiplier).toBeLessThan(1.0);
  });

  it('entry shape has all required LeaderboardEntry fields', async () => {
    const sql = makeSql(makeResponses());
    const { entries } = await computeMonthlyScores(sql as never, { year: 2026, month: 4 });
    const e = entries[0];
    const requiredFields: Array<keyof typeof e> = [
      'indexer_address', 'period_type', 'period_start', 'period_end',
      'query_fee_score', 'allocation_efficiency_score', 'delegator_apr_score',
      'effective_cut_score', 'capacity_score', 'cut_stability_score',
      'tenure_bonus', 'retention_score', 'reo_score', 'poi_consensus_score',
      'allocation_breadth_score', 'community_vote_score', 'subtotal',
      'penalty_multiplier', 'final_score', 'months_active', 'is_eligible_for_badge',
    ];
    for (const field of requiredFields) {
      expect(e).toHaveProperty(field);
    }
  });

  it('handles undecided disputes via dispute processing', async () => {
    const sql = makeSql([
      [baseIndexer],  // 1. allIndexers
      [],             // 2. feeRows
      [],             // 3. effRows
      [],             // 4. cutChanges
      [],             // 5. flowRows
      [],             // 6. breadthRows
      [{ indexer_address: '0xabc', status: 'undecided', closed_at: null }], // 7. disputeRows
      [],             // 8. fees30dRows
      [],             // 9. voteTallyRows
      [],             // 10. DELETE
      [],             // 11. INSERT
    ]);
    const result = await computeMonthlyScores(sql as never, { year: 2026, month: 4 });
    // hasActiveDispute = true → penalty multiplier < 1
    expect(result.entries[0].penalty_multiplier).toBeLessThan(1.0);
  });

  it('handles older accepted disputes (12-24 months ago)', async () => {
    const olderClose = new Date(Date.now() - 18 * 30 * 24 * 3600 * 1000).toISOString(); // 18 months ago
    const sql = makeSql([
      [baseIndexer],
      [], [], [], [], [],
      [{ indexer_address: '0xabc', status: 'accepted', closed_at: olderClose }],
      [], [], [], [],
    ]);
    const result = await computeMonthlyScores(sql as never, { year: 2026, month: 4 });
    // hasOlderSlashing = true → penalty multiplier < 1
    expect(result.entries[0].penalty_multiplier).toBeLessThan(1.0);
  });

  it('handles accepted recent disputes', async () => {
    const recentClose = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(); // 30d ago
    const sql = makeSql([
      [baseIndexer],
      [], [], [], [], [],
      [{ indexer_address: '0xabc', status: 'accepted', closed_at: recentClose }],
      [], [], [], [],
    ]);
    const result = await computeMonthlyScores(sql as never, { year: 2026, month: 4 });
    // hasRecentSlashing = true → penalty multiplier < 1
    expect(result.entries[0].penalty_multiplier).toBeLessThan(1.0);
  });

  it('nudges tied scores apart so they differ', async () => {
    // Two identical indexers will tie — scores should be nudged
    const indexerA = { ...baseIndexer, address: '0xaaa' };
    const indexerB = { ...baseIndexer, address: '0xbbb' };
    const sql = makeSql([
      [indexerA, indexerB],  // 1. allIndexers
      [],  // 2. feeRows
      [],  // 3. effRows
      [],  // 4. cutChanges
      [],  // 5. flowRows
      [],  // 6. breadthRows
      [],  // 7. disputeRows
      [],  // 8. fees30dRows
      [],  // 9. voteTallyRows
      [],  // 10. DELETE
      [],  // 11. INSERT
    ]);

    const result = await computeMonthlyScores(sql as never, { year: 2026, month: 4 });
    const [a, b] = result.entries;
    expect(a.final_score).not.toBe(b.final_score);
  });
});
