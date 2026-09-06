import { NextResponse } from 'next/server';
import type { FeedItem } from '@/lib/feed';
import newsData from '@/data/news.json';

import { cached } from '@/lib/cache';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchSqlReady } from '@/lib/nuthatch';
import { epochFeedItems, fromNestEpoch, nestEpochsSql } from '@/lib/feed-epochs';
import type { NestEpoch } from '@/lib/feed-epochs';

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

// ── Nest config ──────────────────────────────────────────────────
/** The nest carrying `lodestar_epochs`; `/alloc` fronts graph-allocations-nest. */
const FEED_BASE_PATH = process.env.NUTHATCH_FEED_BASE_PATH || '/alloc';

// ── External API response shapes (minimal — only fields we read) ──

interface ForumTopic {
  id: number;
  title: string;
  excerpt?: string;
  slug: string;
  bumped_at?: string;
  created_at?: string;
  tags?: string[];
  views?: number;
  reply_count?: number;
  pinned?: boolean;
}

interface GitHubCommit {
  sha: string;
  html_url: string;
  commit?: { message?: string; author?: { date?: string; name?: string } };
  author?: { login?: string };
}

interface GitHubLabel {
  name: string;
}

interface GitHubIssue {
  number: number;
  title: string;
  body?: string;
  html_url: string;
  created_at: string;
  pull_request?: unknown;
  labels?: GitHubLabel[];
  user?: { login?: string };
}

interface GitHubPR {
  number: number;
  title: string;
  body?: string;
  html_url: string;
  created_at: string;
  labels?: GitHubLabel[];
  user?: { login?: string };
}

interface GitHubRelease {
  id: number;
  tag_name: string;
  body?: string;
  html_url: string;
  published_at?: string;
  created_at?: string;
  author?: { login?: string };
}

interface SnapshotProposal {
  id: string;
  title: string;
  body?: string;
  state: string;
  start: number;
  end: number;
  choices?: string[];
  scores?: number[];
  scores_total?: number;
  votes?: number;
  author?: string;
}

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

      return (topics as ForumTopic[])
        .filter((t) => !t.pinned) // skip pinned "about" topics
        .slice(0, 8)
        .map((topic): FeedItem => ({
          id: `forum-${topic.id}`,
          type: cat.type,
          title: topic.title,
          summary: topic.excerpt
            ? topic.excerpt.replace(/<[^>]*>/g, '').slice(0, 200)
            : '',
          url: `${FORUM_BASE}/t/${topic.slug}/${topic.id}`,
          timestamp: topic.bumped_at || topic.created_at || new Date().toISOString(),
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

/**
 * GitHub fetch that says something when the rejection is our fault.
 *
 * Every caller below folds a failure into an empty array, so an expired
 * GITHUB_TOKEN silently strips the gip/issue/pr/release categories out of the
 * feed while the endpoint keeps returning 200. That went unnoticed for six
 * weeks. 401 and 403 are worth a warning; anything else stays quiet, since
 * transient upstream errors are already handled by returning nothing.
 */
async function ghFetch(url: string, source: string): Promise<Response | null> {
  const res = await fetch(url, { headers: GH_HEADERS });
  if (res.ok) return res;
  if (res.status === 401 || res.status === 403) {
    log.api.warn(
      {
        status: res.status,
        source,
        hasToken: Boolean(GITHUB_TOKEN),
        // 403 with no remaining quota is rate limiting, not a bad credential.
        rateLimitRemaining: res.headers.get('x-ratelimit-remaining'),
      },
      'GitHub rejected a feed request; check GITHUB_TOKEN validity and rate limit',
    );
  }
  return null;
}

async function fetchGIPCommits(): Promise<FeedItem[]> {
  try {
    const res = await ghFetch(GIP_COMMITS_URL, 'gip-commits');
    if (!res) return [];

    const commits: GitHubCommit[] = await res.json();

    return commits.map((c): FeedItem => {
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
      const res = await ghFetch(
        `https://api.github.com/repos/${repo}/issues?state=open&sort=created&direction=desc&per_page=5`,
        `issues:${repo}`,
      );
      if (!res) return [];

      const issues: GitHubIssue[] = await res.json();
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
          tags: (issue.labels ?? []).map((l) => l.name).slice(0, 3),
          metadata: {
            author: issue.user?.login,
            repo: repo.split('/')[1],
            labels: (issue.labels ?? []).map((l) => l.name),
          },
        }));
    })
  );

  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

async function fetchRepoPRs(): Promise<FeedItem[]> {
  const results = await Promise.allSettled(
    TRACKED_REPOS.map(async (repo) => {
      const res = await ghFetch(
        `https://api.github.com/repos/${repo}/pulls?state=open&sort=created&direction=desc&per_page=5`,
        `pulls:${repo}`,
      );
      if (!res) return [];

      const prs: GitHubPR[] = await res.json();
      return prs.map((pr): FeedItem => ({
        id: `pr-${repo}-${pr.number}`,
        type: 'pr',
        title: pr.title,
        summary: pr.body ? pr.body.replace(/\r?\n/g, ' ').slice(0, 200) : '',
        url: pr.html_url,
        timestamp: pr.created_at,
        tags: (pr.labels ?? []).map((l) => l.name).slice(0, 3),
        metadata: {
          author: pr.user?.login,
          repo: repo.split('/')[1],
          labels: (pr.labels ?? []).map((l) => l.name),
        },
      }));
    })
  );

  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

async function fetchRepoReleases(): Promise<FeedItem[]> {
  const results = await Promise.allSettled(
    TRACKED_REPOS.map(async (repo) => {
      const res = await ghFetch(
        `https://api.github.com/repos/${repo}/releases?per_page=3`,
        `releases:${repo}`,
      );
      if (!res) return [];

      const releases: GitHubRelease[] = await res.json();
      return releases.map((rel): FeedItem => ({
        id: `release-${repo}-${rel.id}`,
        type: 'release',
        title: `${repo.split('/')[1]} ${rel.tag_name}`,
        summary: rel.body ? rel.body.replace(/\r?\n/g, ' ').slice(0, 200) : '',
        url: rel.html_url,
        timestamp: rel.published_at ?? rel.created_at ?? new Date().toISOString(),
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

    return (proposals as SnapshotProposal[]).map((p): FeedItem => {
      const bodySnippet = p.body
        ? p.body.replace(/[#*`[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
        : '';

      const winningIdx = p.scores && p.scores.length > 0
        ? p.scores.indexOf(Math.max(...p.scores))
        : -1;
      const winningChoice = winningIdx >= 0 ? p.choices?.[winningIdx] : undefined;

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

/**
 * Epoch summaries from the nest's `lodestar_epochs`, shaped by `feed-epochs.ts`
 * (nightswatchhq/nuthatch#1078, #1160). The Graph Network subgraph this once fell back to left with
 * the key; without a nest there are no epoch items, and the rest of the feed still renders.
 */
async function fetchEpochSummaries(): Promise<FeedItem[]> {
  if (!hasNuthatch()) return [];
  const res = await nuthatchSqlReady<NestEpoch>(nestEpochsSql(5), FEED_BASE_PATH);
  if (!res.ok) {
    log.api.warn({ status: res.status, error: res.error }, 'Epoch summaries from the nest failed');
    return [];
  }
  return epochFeedItems(res.data.rows.map(fromNestEpoch));
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
