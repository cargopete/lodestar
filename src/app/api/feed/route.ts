import { NextResponse } from 'next/server';
import type { FeedItem } from '@/lib/feed';
import newsData from '@/data/news.json';

import { cached } from '@/lib/cache';

// ── Forum config ─────────────────────────────────────────────────
const FORUM_BASE = 'https://forum.thegraph.com';
const FORUM_CATEGORIES: { id: number; type: 'governance' | 'announcement' }[] = [
  { id: 17, type: 'governance' },  // Governance & GIPs
  { id: 29, type: 'governance' },  // Graph Advocates / DAO
  { id: 11, type: 'announcement' }, // Announcements
];

// ── GitHub config ────────────────────────────────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GH_HEADERS: Record<string, string> = {
  Accept: 'application/vnd.github.v3+json',
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
};

const GIP_COMMITS_URL =
  'https://api.github.com/repos/graphprotocol/graph-improvement-proposals/commits?per_page=10';

const SNAPSHOT_GRAPHQL = 'https://hub.snapshot.org/graphql';
const SNAPSHOT_SPACE = 'council.graphprotocol.eth';

const TRACKED_REPOS = [
  'graphprotocol/graph-node',
  'graphprotocol/indexer',
  'graphprotocol/contracts',
  'graphprotocol/graph-tooling',
];

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
    const res = await fetch(GIP_COMMITS_URL, { headers: GH_HEADERS });
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

async function fetchRepoIssues(): Promise<FeedItem[]> {
  const results = await Promise.allSettled(
    TRACKED_REPOS.map(async (repo) => {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/issues?state=open&sort=created&direction=desc&per_page=5`,
        { headers: GH_HEADERS }
      );
      if (!res.ok) return [];

      const issues: any[] = await res.json();
      // The issues endpoint also returns PRs — filter them out
      return issues
        .filter((i) => !i.pull_request)
        .map((issue): FeedItem => ({
          id: `issue-${repo}-${issue.number}`,
          type: 'issue',
          title: issue.title,
          summary: issue.body ? issue.body.replace(/\r?\n/g, ' ').slice(0, 200) : '',
          url: issue.html_url,
          timestamp: issue.created_at,
          tags: (issue.labels ?? []).map((l: any) => l.name).slice(0, 3),
          metadata: {
            author: issue.user?.login,
            repo: repo.split('/')[1],
            labels: (issue.labels ?? []).map((l: any) => l.name),
          },
        }));
    })
  );

  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

async function fetchRepoPRs(): Promise<FeedItem[]> {
  const results = await Promise.allSettled(
    TRACKED_REPOS.map(async (repo) => {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/pulls?state=open&sort=created&direction=desc&per_page=5`,
        { headers: GH_HEADERS }
      );
      if (!res.ok) return [];

      const prs: any[] = await res.json();
      return prs.map((pr): FeedItem => ({
        id: `pr-${repo}-${pr.number}`,
        type: 'pr',
        title: pr.title,
        summary: pr.body ? pr.body.replace(/\r?\n/g, ' ').slice(0, 200) : '',
        url: pr.html_url,
        timestamp: pr.created_at,
        tags: (pr.labels ?? []).map((l: any) => l.name).slice(0, 3),
        metadata: {
          author: pr.user?.login,
          repo: repo.split('/')[1],
          labels: (pr.labels ?? []).map((l: any) => l.name),
        },
      }));
    })
  );

  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

async function fetchRepoReleases(): Promise<FeedItem[]> {
  const results = await Promise.allSettled(
    TRACKED_REPOS.map(async (repo) => {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/releases?per_page=3`,
        { headers: GH_HEADERS }
      );
      if (!res.ok) return [];

      const releases: any[] = await res.json();
      return releases.map((rel): FeedItem => ({
        id: `release-${repo}-${rel.id}`,
        type: 'release',
        title: `${repo.split('/')[1]} ${rel.tag_name}`,
        summary: rel.body ? rel.body.replace(/\r?\n/g, ' ').slice(0, 200) : '',
        url: rel.html_url,
        timestamp: rel.published_at ?? rel.created_at,
        tags: [repo.split('/')[1]],
        metadata: {
          author: rel.author?.login,
          repo: repo.split('/')[1],
          releaseTag: rel.tag_name,
        },
      }));
    })
  );

  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

async function fetchSnapshotProposals(): Promise<FeedItem[]> {
  try {
    const query = `{
      proposals(
        first: 10,
        where: { space: "${SNAPSHOT_SPACE}" },
        orderBy: "created",
        orderDirection: desc
      ) {
        id
        title
        body
        state
        start
        end
        choices
        scores
        scores_total
        votes
        author
      }
    }`;

    const res = await fetch(SNAPSHOT_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) return [];
    const json = await res.json();
    const proposals = json?.data?.proposals ?? [];

    return proposals.map((p: any): FeedItem => {
      const bodySnippet = p.body
        ? p.body.replace(/[#*`[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
        : '';

      const winningIdx = p.scores && p.scores.length > 0
        ? p.scores.indexOf(Math.max(...p.scores))
        : -1;
      const winningChoice = winningIdx >= 0 ? p.choices[winningIdx] : undefined;

      return {
        id: `snapshot-${p.id}`,
        type: 'vote',
        title: p.title,
        summary: bodySnippet,
        url: `https://snapshot.org/#/${SNAPSHOT_SPACE}/proposal/${p.id}`,
        timestamp: new Date(p.start * 1000).toISOString(),
        tags: [p.state],
        metadata: {
          author: p.author ? `${p.author.slice(0, 6)}…${p.author.slice(-4)}` : undefined,
          snapshotState: p.state,
          snapshotVotes: p.votes,
          snapshotEnd: new Date(p.end * 1000).toISOString(),
          winningChoice,
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
    const [forumItems, gipItems, snapshotItems, epochItems, issueItems, prItems, releaseItems] = await Promise.all([
      fetchForumTopics(),
      fetchGIPCommits(),
      fetchSnapshotProposals(),
      fetchEpochSummaries(),
      fetchRepoIssues(),
      fetchRepoPRs(),
      fetchRepoReleases(),
    ]);

    return [...(newsData as FeedItem[]), ...forumItems, ...gipItems, ...snapshotItems, ...epochItems, ...issueItems, ...prItems, ...releaseItems]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 60);
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
