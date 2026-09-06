// The epoch summaries in the network activity feed, shaped once for both sources
// (nightswatchhq/nuthatch#1078). The Graph Network subgraph's `epoches` and the nest's
// `lodestar_epochs` view carry the same six facts under different names; everything the feed says
// about an epoch is derived here from those six, so the two paths cannot drift in wording or maths.
import type { FeedItem } from '@/lib/feed';

/** One epoch, in the field names the feed reasons about. Token amounts are decimal strings in wei. */
export interface EpochSummary {
  id: string;
  startBlock: string;
  endBlock: string;
  totalRewards: string;
  totalDelegatorRewards: string;
  totalQueryFees: string;
}

/** The nest's row shape, as `lodestar_epochs` on graph-allocations-nest returns it. */
export interface NestEpoch {
  id: number | string;
  start_block: number | string;
  end_block: number | string;
  total_rewards: string | number;
  total_delegator_rewards: string | number;
  query_fees_collected: string | number;
}

/**
 * `query_fees_collected` is the subgraph's `totalQueryFees` by construction (nuthatch#1113, #1116:
 * the two matched 68 of 68 at a pinned block once the epoch boundary was exact), so it maps
 * straight across.
 */
export function fromNestEpoch(e: NestEpoch): EpochSummary {
  return {
    id: String(e.id),
    startBlock: String(e.start_block),
    endBlock: String(e.end_block),
    totalRewards: String(e.total_rewards ?? '0'),
    totalDelegatorRewards: String(e.total_delegator_rewards ?? '0'),
    totalQueryFees: String(e.query_fees_collected ?? '0'),
  };
}

/** The SQL the nest path runs: newest `limit` epochs, the same five plus id the subgraph query asks for. */
export function nestEpochsSql(limit: number): string {
  return `SELECT id, start_block, end_block, total_rewards, total_delegator_rewards, query_fees_collected FROM lodestar_epochs ORDER BY start_block DESC LIMIT ${Math.max(1, Math.floor(limit))}`;
}

function grt(wei: string | undefined): number {
  return Number(BigInt((wei ?? '0').split('.')[0] || '0')) / 1e18;
}

/**
 * Feed items from epochs ordered newest first. Each item compares an epoch with the one before it,
 * so `n` epochs yield `n - 1` items and fewer than two yield none. `now` is injectable because the
 * timestamp is an estimate (about 6.4 hours per epoch back from now), not a fact from the data.
 */
export function epochFeedItems(epochs: EpochSummary[], now: number = Date.now()): FeedItem[] {
  if (epochs.length < 2) return [];
  const items: FeedItem[] = [];
  for (let i = 0; i < epochs.length - 1; i++) {
    const current = epochs[i];
    const previous = epochs[i + 1];

    const currentRewards = grt(current.totalRewards);
    const prevRewards = grt(previous.totalRewards);
    const currentFees = grt(current.totalQueryFees);
    const prevFees = grt(previous.totalQueryFees);

    const rewardsDelta = prevRewards > 0 ? (((currentRewards - prevRewards) / prevRewards) * 100).toFixed(1) : '0';
    const queryFeeDelta = prevFees > 0 ? (((currentFees - prevFees) / prevFees) * 100).toFixed(1) : '0';

    const delegatorRewards = grt(current.totalDelegatorRewards);
    const distributed = delegatorRewards > 1000 ? `${(delegatorRewards / 1000).toFixed(1)}K` : delegatorRewards.toFixed(0);

    const epochNum = parseInt(current.id);
    const sign = parseFloat(rewardsDelta) >= 0 ? '+' : '';

    items.push({
      id: `epoch-${current.id}`,
      type: 'epoch',
      title: `Epoch ${epochNum}`,
      summary: `${sign}${rewardsDelta}% rewards, ${parseFloat(queryFeeDelta) >= 0 ? '+' : ''}${queryFeeDelta}% query fees. ${distributed} GRT distributed to delegators.`,
      url: '',
      timestamp: new Date(now - i * 6.4 * 60 * 60 * 1000).toISOString(),
      tags: ['epoch'],
      metadata: {
        epochNumber: epochNum,
        rewardsDelta,
        queryFeeDelta,
        totalDistributed: distributed,
      },
    });
  }
  return items;
}
