import { describe, it, expect } from 'vitest';
import { epochFeedItems, fromNestEpoch, fromSubgraphEpoch, nestEpochsSql } from '../feed-epochs';

const GRT = (n: number) => `${BigInt(n) * 10n ** 18n}`;

describe('feed-epochs (nuthatch#1078)', () => {
  it('shapes a nest row and a subgraph row to the same summary', () => {
    const fromNest = fromNestEpoch({
      id: 1371,
      start_block: 501000000,
      end_block: 501007199,
      total_rewards: GRT(1200),
      total_delegator_rewards: GRT(300),
      query_fees_collected: GRT(50),
    });
    const fromSubgraph = fromSubgraphEpoch({
      id: '1371',
      startBlock: '501000000',
      endBlock: '501007199',
      totalRewards: GRT(1200),
      totalIndexerRewards: GRT(900),
      totalDelegatorRewards: GRT(300),
      totalQueryFees: GRT(50),
      queryFeeRebates: '0',
    });
    expect(fromNest).toEqual(fromSubgraph);
  });

  it('yields n - 1 items, each comparing an epoch with the one before it', () => {
    const now = Date.UTC(2026, 8, 4, 7, 0, 0);
    const items = epochFeedItems(
      [
        { id: '3', startBlock: '30', endBlock: '39', totalRewards: GRT(1100), totalDelegatorRewards: GRT(2500), totalQueryFees: GRT(60) },
        { id: '2', startBlock: '20', endBlock: '29', totalRewards: GRT(1000), totalDelegatorRewards: GRT(400), totalQueryFees: GRT(80) },
        { id: '1', startBlock: '10', endBlock: '19', totalRewards: GRT(500), totalDelegatorRewards: GRT(100), totalQueryFees: GRT(40) },
      ],
      now,
    );
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('epoch-3');
    expect(items[0].title).toBe('Epoch 3');
    expect(items[0].summary).toBe('+10.0% rewards, -25.0% query fees. 2.5K GRT distributed to delegators.');
    expect(items[0].metadata).toMatchObject({ epochNumber: 3, rewardsDelta: '10.0', queryFeeDelta: '-25.0', totalDistributed: '2.5K' });
    expect(items[0].timestamp).toBe(new Date(now).toISOString());
    expect(items[1].summary).toBe('+100.0% rewards, +100.0% query fees. 400 GRT distributed to delegators.');
    expect(items[1].timestamp).toBe(new Date(now - 6.4 * 60 * 60 * 1000).toISOString());
  });

  it('says nothing with fewer than two epochs, and 0% against an empty previous epoch', () => {
    expect(epochFeedItems([])).toEqual([]);
    expect(
      epochFeedItems([{ id: '9', startBlock: '1', endBlock: '2', totalRewards: GRT(1), totalDelegatorRewards: '0', totalQueryFees: '0' }]),
    ).toEqual([]);
    const [item] = epochFeedItems([
      { id: '2', startBlock: '20', endBlock: '29', totalRewards: GRT(10), totalDelegatorRewards: '0', totalQueryFees: GRT(1) },
      { id: '1', startBlock: '10', endBlock: '19', totalRewards: '0', totalDelegatorRewards: '0', totalQueryFees: '0' },
    ]);
    expect(item.summary).toBe('+0% rewards, +0% query fees. 0 GRT distributed to delegators.');
  });

  it('asks the nest for exactly the six columns the summary needs, newest first', () => {
    const sql = nestEpochsSql(5);
    expect(sql).toBe(
      'SELECT id, start_block, end_block, total_rewards, total_delegator_rewards, query_fees_collected FROM lodestar_epochs ORDER BY start_block DESC LIMIT 5',
    );
    expect(nestEpochsSql(0)).toMatch(/LIMIT 1$/);
  });
});
