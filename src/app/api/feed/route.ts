import { NextResponse } from 'next/server';
import type { FeedItem } from '@/lib/feed';

import { cached } from '@/lib/cache';

// ── Forum config ─────────────────────────────────────────────────
const FORUM_BASE = 'https://forum.thegraph.com';
const FORUM_CATEGORIES: { id: number; type: 'governance' | 'announcement' }[] = [
  { id: 17, type: 'governance' },  // Governance & GIPs
  { id: 29, type: 'governance' },  // Graph Advocates / DAO
  { id: 11, type: 'announcement' }, // Announcements
];

// ── GitHub config ────────────────────────────────────────────────
const GIP_COMMITS_URL =
  'https://api.github.com/repos/graphprotocol/graph-improvement-proposals/commits?per_page=10';

// ── Subgraph config ──────────────────────────────────────────────
const SUBGRAPH_URL = process.env.GRAPH_API_KEY
  ? `https://gateway-arbitrum.network.thegraph.com/api/${process.env.GRAPH_API_KEY}/subgraphs/id/DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp`
  : null;

// ── Fetchers ─────────────────────────────────────────────────────

async function fetchForumTopics(): Promise<FeedItem[]> {
  const items: FeedItem[] = [];

  const results = await Promise.allSettled(
    FORUM_CATEGORIES.map(async (cat) => {
      const res = await fetch(`${FORUM_BASE}/c/${cat.id}.json`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return [];

      const data = await res.json();
      const topics = data?.topic_list?.topics ?? [];

      return topics
        .filter((t: any) => !t.pinned) // skip pinned "about" topics
        .slice(0, 8)
        .map((topic: any): FeedItem => ({
          id: `forum-${topic.id}`,
          type: cat.type,
          title: topic.title,
          summary: topic.excerpt
            ? topic.excerpt.replace(/<[^>]*>/g, '').slice(0, 200)
            : '',
          url: `${FORUM_BASE}/t/${topic.slug}/${topic.id}`,
          timestamp: topic.bumped_at || topic.created_at,
          tags: topic.tags || [],
          metadata: {
            views: topic.views,
            replies: topic.reply_count,
          },
        }));
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    }
  }

  return items;
}

async function fetchGIPCommits(): Promise<FeedItem[]> {
  try {
    const res = await fetch(GIP_COMMITS_URL, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return [];

    const commits = await res.json();

    return commits.map((c: any): FeedItem => {
      const message = c.commit?.message ?? '';
      const firstLine = message.split('\n')[0].slice(0, 120);

      // Try to extract GIP numbers from the message
      const gipMatch = message.match(/GIP[- ]?(\d+)/gi);
      const tags: string[] = gipMatch
        ? [...new Set(gipMatch.map((m: string) => m.replace(/[- ]/g, '-').toUpperCase()))] as string[]
        : [];

      return {
        id: `gip-${c.sha.slice(0, 8)}`,
        type: 'gip',
        title: firstLine,
        summary: message.length > 120 ? message.slice(120, 300).trim() : '',
        url: c.html_url,
        timestamp: c.commit?.author?.date ?? new Date().toISOString(),
        tags,
        metadata: {
          author: c.author?.login ?? c.commit?.author?.name ?? 'unknown',
          gipStage: gipMatch ? 'Updated' : undefined,
        },
      };
    });
  } catch {
    return [];
  }
}

async function fetchEpochSummaries(): Promise<FeedItem[]> {
  if (!SUBGRAPH_URL) return [];

  try {
    const query = `{
      epoches(first: 5, orderBy: startBlock, orderDirection: desc) {
        id
        startBlock
        endBlock
        totalRewards
        totalIndexerRewards
        totalDelegatorRewards
        totalQueryFees
        queryFeeRebates
      }
    }`;

    const res = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) return [];

    const json = await res.json();
    const epochs = json?.data?.epoches ?? [];
    if (epochs.length < 2) return [];

    const items: FeedItem[] = [];

    for (let i = 0; i < epochs.length - 1; i++) {
      const current = epochs[i];
      const previous = epochs[i + 1];

      const currentRewards = Number(BigInt(current.totalRewards?.split('.')[0] || '0')) / 1e18;
      const prevRewards = Number(BigInt(previous.totalRewards?.split('.')[0] || '0')) / 1e18;
      const currentFees = Number(BigInt(current.totalQueryFees?.split('.')[0] || '0')) / 1e18;
      const prevFees = Number(BigInt(previous.totalQueryFees?.split('.')[0] || '0')) / 1e18;

      const rewardsDelta = prevRewards > 0
        ? ((currentRewards - prevRewards) / prevRewards * 100).toFixed(1)
        : '0';
      const queryFeeDelta = prevFees > 0
        ? ((currentFees - prevFees) / prevFees * 100).toFixed(1)
        : '0';

      const delegatorRewards = Number(BigInt(current.totalDelegatorRewards?.split('.')[0] || '0')) / 1e18;
      const distributed = delegatorRewards > 1000
        ? `${(delegatorRewards / 1000).toFixed(1)}K`
        : delegatorRewards.toFixed(0);

      const epochNum = parseInt(current.id);
      const sign = parseFloat(rewardsDelta) >= 0 ? '+' : '';

      items.push({
        id: `epoch-${current.id}`,
        type: 'epoch',
        title: `Epoch ${epochNum}`,
        summary: `${sign}${rewardsDelta}% rewards, ${parseFloat(queryFeeDelta) >= 0 ? '+' : ''}${queryFeeDelta}% query fees. ${distributed} GRT distributed to delegators.`,
        url: '',
        timestamp: new Date(
          Date.now() - i * 6.4 * 60 * 60 * 1000 // ~6.4 hours per epoch
        ).toISOString(),
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
  } catch {
    return [];
  }
}

// ── Route handler ────────────────────────────────────────────────

export async function GET() {
  const items = await cached('lodestar:feed', 300, async () => {
    const [forumItems, gipItems, epochItems] = await Promise.all([
      fetchForumTopics(),
      fetchGIPCommits(),
      fetchEpochSummaries(),
    ]);

    return [...forumItems, ...gipItems, ...epochItems]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 40);
  });

  return NextResponse.json(
    { items },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    }
  );
}
