import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FeedItem } from '@/lib/feed';

// cached() just runs the fetcher (bypass Redis).
vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => Promise<unknown>) => f()),
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn(),
  hasRedis: vi.fn(() => false),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Canned upstream payloads ---------------------------------------------------

const forumPayload = {
  topic_list: {
    topics: [
      {
        id: 101,
        title: 'GIP-0099 discussion',
        excerpt: '<p>Some <b>HTML</b> excerpt</p>',
        slug: 'gip-0099-discussion',
        bumped_at: '2026-05-20T00:00:00.000Z',
        tags: ['gip'],
        views: 42,
        reply_count: 7,
        pinned: false,
      },
      {
        id: 102,
        title: 'About this category',
        excerpt: 'pinned about topic',
        slug: 'about',
        pinned: true, // must be filtered out
      },
    ],
  },
};

const ghCommitsPayload = [
  {
    sha: 'abcdef1234567890',
    html_url: 'https://github.com/graphprotocol/gips/commit/abcdef',
    commit: {
      message: 'GIP-0079: update oracle params\n\nLong body text follows here with detail.',
      author: { date: '2026-05-19T00:00:00.000Z', name: 'Alice' },
    },
    author: { login: 'alice-gh' },
  },
];

const ghIssuesPayload = [
  {
    number: 555,
    title: 'graph-node panics on reorg',
    body: 'line1\r\nline2',
    html_url: 'https://github.com/graphprotocol/graph-node/issues/555',
    created_at: '2026-05-18T00:00:00.000Z',
    labels: [{ name: 'bug' }, { name: 'p1' }, { name: 'reorg' }, { name: 'extra' }],
    user: { login: 'bob' },
  },
  {
    // a PR masquerading as an issue — must be filtered out
    number: 556,
    title: 'fix: thing',
    html_url: 'https://github.com/graphprotocol/graph-node/pull/556',
    created_at: '2026-05-17T00:00:00.000Z',
    pull_request: { url: 'x' },
  },
];

const ghPullsPayload = [
  {
    number: 777,
    title: 'feat: add Horizon provisions',
    body: 'pr body',
    html_url: 'https://github.com/graphprotocol/contracts/pull/777',
    created_at: '2026-05-16T00:00:00.000Z',
    labels: [{ name: 'feature' }],
    user: { login: 'carol' },
  },
];

const ghReleasesPayload = [
  {
    id: 9001,
    tag_name: 'v0.43.0',
    body: 'release notes',
    html_url: 'https://github.com/graphprotocol/graph-node/releases/v0.43.0',
    published_at: '2026-05-15T00:00:00.000Z',
    author: { login: 'releasebot' },
  },
];

const snapshotPayload = {
  data: {
    proposals: [
      {
        id: '0xprop1',
        title: 'Fund the lighthouse',
        body: '## Heading\n\nSome **markdown** body with [links](x).',
        state: 'closed',
        start: 1_700_000_000,
        end: 1_700_600_000,
        choices: ['For', 'Against'],
        scores: [10, 90],
        scores_total: 100,
        votes: 33,
        author: '0x1234567890abcdef1234567890abcdef12345678',
      },
    ],
  },
};

// Route a fetch by URL to the right canned payload.
function routeFetch(url: string): Response {
  if (url.includes('forum.thegraph.com')) return new Response(JSON.stringify(forumPayload), { status: 200 });
  if (url.includes('graph-improvement-proposals/commits'))
    return new Response(JSON.stringify(ghCommitsPayload), { status: 200 });
  if (url.includes('/issues')) return new Response(JSON.stringify(ghIssuesPayload), { status: 200 });
  if (url.includes('/pulls')) return new Response(JSON.stringify(ghPullsPayload), { status: 200 });
  if (url.includes('/releases')) return new Response(JSON.stringify(ghReleasesPayload), { status: 200 });
  if (url.includes('snapshot.org')) return new Response(JSON.stringify(snapshotPayload), { status: 200 });
  return new Response('[]', { status: 200 });
}

async function getItems(): Promise<FeedItem[]> {
  const mod = await import('@/app/api/feed/route');
  const res = await mod.GET();
  const body = await res.json();
  return body.items as FeedItem[];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.GRAPH_API_KEY; // keep epoch fetcher inert by default
  mockFetch.mockImplementation((url: string) => Promise.resolve(routeFetch(url)));
});

describe('GET /api/feed — source mapping', () => {
  it('sets cache headers and returns an items array', async () => {
    const mod = await import('@/app/api/feed/route');
    const res = await mod.GET();
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=60');
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('maps a forum topic, strips HTML, and skips pinned topics', async () => {
    const items = await getItems();
    const forum = items.find((i) => i.id === 'forum-101');
    expect(forum).toBeDefined();
    expect(forum!.type).toBe('governance');
    expect(forum!.title).toBe('GIP-0099 discussion');
    expect(forum!.summary).toBe('Some HTML excerpt'); // tags stripped
    expect(forum!.url).toContain('/t/gip-0099-discussion/101');
    expect(forum!.metadata.views).toBe(42);
    expect(forum!.metadata.replies).toBe(7);
    // pinned topic excluded
    expect(items.find((i) => i.id === 'forum-102')).toBeUndefined();
  });

  it('maps a GIP commit and extracts GIP tags', async () => {
    const items = await getItems();
    const gip = items.find((i) => i.id === 'gip-abcdef12');
    expect(gip).toBeDefined();
    expect(gip!.type).toBe('gip');
    expect(gip!.title).toBe('GIP-0079: update oracle params');
    expect(gip!.tags).toContain('GIP-0079');
    expect(gip!.metadata.author).toBe('alice-gh');
    expect(gip!.metadata.gipStage).toBe('Updated');
  });

  it('maps GitHub issues, filters out PRs, and caps tags at 3', async () => {
    const items = await getItems();
    const issue = items.find((i) => i.id === 'issue-graphprotocol/graph-node-555');
    expect(issue).toBeDefined();
    expect(issue!.type).toBe('issue');
    expect(issue!.summary).toBe('line1 line2'); // newlines collapsed
    expect(issue!.tags).toHaveLength(3); // sliced from 4 labels
    expect(issue!.metadata.repo).toBe('graph-node');
    expect(issue!.metadata.labels).toHaveLength(4); // full set retained in metadata
    // the PR (#556) must not appear as an issue
    expect(items.find((i) => i.id === 'issue-graphprotocol/graph-node-556')).toBeUndefined();
  });

  it('maps GitHub pull requests', async () => {
    const items = await getItems();
    const pr = items.find((i) => i.id === 'pr-graphprotocol/contracts-777');
    expect(pr).toBeDefined();
    expect(pr!.type).toBe('pr');
    expect(pr!.title).toBe('feat: add Horizon provisions');
    expect(pr!.metadata.repo).toBe('contracts');
  });

  it('maps GitHub releases with a repo-prefixed title', async () => {
    const items = await getItems();
    const rel = items.find((i) => i.id === 'release-graphprotocol/graph-node-9001');
    expect(rel).toBeDefined();
    expect(rel!.type).toBe('release');
    expect(rel!.title).toBe('graph-node v0.43.0');
    expect(rel!.metadata.releaseTag).toBe('v0.43.0');
  });

  it('maps a Snapshot proposal, strips markdown, and computes the winning choice', async () => {
    const items = await getItems();
    const vote = items.find((i) => i.id === 'snapshot-0xprop1');
    expect(vote).toBeDefined();
    expect(vote!.type).toBe('vote');
    expect(vote!.summary).not.toContain('#');
    expect(vote!.summary).not.toContain('**');
    expect(vote!.metadata.snapshotState).toBe('closed');
    expect(vote!.metadata.snapshotVotes).toBe(33);
    expect(vote!.metadata.winningChoice).toBe('Against'); // index of max score (90)
    expect(vote!.metadata.author).toBe('0x1234…5678');
  });

  it('always includes the static news items', async () => {
    const items = await getItems();
    expect(items.some((i) => i.type === 'news')).toBe(true);
  });
});

describe('GET /api/feed — fault tolerance (Promise.allSettled)', () => {
  it('still returns other sources when the forum fetch rejects', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('forum.thegraph.com')) return Promise.reject(new Error('forum down'));
      return Promise.resolve(routeFetch(url));
    });
    const items = await getItems();
    // forum gone, but github + snapshot + news survive
    expect(items.find((i) => i.id === 'forum-101')).toBeUndefined();
    expect(items.find((i) => i.id === 'gip-abcdef12')).toBeDefined();
    expect(items.find((i) => i.id === 'snapshot-0xprop1')).toBeDefined();
    expect(items.some((i) => i.type === 'news')).toBe(true);
  });

  it('drops a source returning a non-ok status but keeps the rest', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('snapshot.org')) return Promise.resolve(new Response('err', { status: 503 }));
      return Promise.resolve(routeFetch(url));
    });
    const items = await getItems();
    expect(items.find((i) => i.id === 'snapshot-0xprop1')).toBeUndefined();
    expect(items.find((i) => i.id === 'forum-101')).toBeDefined();
  });

  it('survives every upstream rejecting and still returns the static news', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('all down')));
    const items = await getItems();
    expect(Array.isArray(items)).toBe(true);
    expect(items.some((i) => i.type === 'news')).toBe(true);
  });

  it('sorts items newest-first by timestamp', async () => {
    const items = await getItems();
    for (let i = 1; i < items.length; i++) {
      const prev = new Date(items[i - 1].timestamp).getTime();
      const cur = new Date(items[i].timestamp).getTime();
      expect(prev).toBeGreaterThanOrEqual(cur);
    }
  });
});
