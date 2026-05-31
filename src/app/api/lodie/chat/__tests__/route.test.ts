import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// db is a tagged-template function (postgres.js style). We mock it as a fn that
// resolves to whatever the test queues; default = empty rows so buildContext is benign.
const dbResults: unknown[] = [];
const mockDb = vi.fn(() => Promise.resolve(dbResults.shift() ?? []));
vi.mock('@/lib/db', () => ({
  get db() {
    return mockDb;
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeRequest(body: unknown, raw = false): NextRequest {
  return new NextRequest(new URL('/api/lodie/chat', 'http://localhost:3000'), {
    method: 'POST',
    body: raw ? (body as string) : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

let POST: (req: NextRequest) => Promise<Response>;

describe('/api/lodie/chat', () => {
  const ORIG = { ...process.env };

  beforeEach(async () => {
    vi.clearAllMocks();
    dbResults.length = 0;
    process.env.OLLAMA_URL = 'http://ollama.local';
    delete process.env.OLLAMA_SECRET;
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ message: { content: 'The tides suggest calm.' } }), { status: 200 }),
    );
    const mod = await import('@/app/api/lodie/chat/route');
    POST = mod.POST as typeof POST;
  });

  afterEach(() => {
    process.env = { ...ORIG };
  });

  it('returns 400 on invalid JSON body', async () => {
    const res = await POST(makeRequest('not-json{', true));
    expect(res.status).toBe(400);
  });

  it('returns 400 when message is empty/whitespace', async () => {
    const res = await POST(makeRequest({ message: '   ', page: '/' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when message is missing', async () => {
    const res = await POST(makeRequest({ page: '/' }));
    expect(res.status).toBe(400);
  });

  it('returns 503 when OLLAMA_URL is not configured', async () => {
    delete process.env.OLLAMA_URL;
    const res = await POST(makeRequest({ message: 'hi', page: '/' }));
    expect(res.status).toBe(503);
  });

  it('returns plain-text answer on the happy path', async () => {
    const res = await POST(makeRequest({ message: 'what is the network state?', page: '/' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const text = await res.text();
    expect(text).toBe('The tides suggest calm.');
  });

  it('strips markdown from the model response', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: { content: '**Bold** and *italic* and `code` and # head\n- bullet\n1. num' } }),
        { status: 200 },
      ),
    );
    const res = await POST(makeRequest({ message: 'explain delegation', page: '/' }));
    const text = await res.text();
    expect(text).not.toContain('**');
    expect(text).not.toContain('`');
    expect(text).not.toMatch(/^#/m);
    expect(text).not.toMatch(/^- /m);
    expect(text).toContain('Bold');
    expect(text).toContain('italic');
    expect(text).toContain('code');
    expect(text).toContain('bullet');
  });

  it('sends Authorization header when OLLAMA_SECRET is set', async () => {
    process.env.OLLAMA_SECRET = 'sekret';
    vi.resetModules();
    const mod = await import('@/app/api/lodie/chat/route');
    const POST2 = mod.POST as typeof POST;
    await POST2(makeRequest({ message: 'hi', page: '/' }));
    const [, init] = mockFetch.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sekret');
  });

  it('does not send Authorization header when no secret', async () => {
    await POST(makeRequest({ message: 'hi', page: '/' }));
    const [, init] = mockFetch.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('returns 502 when the upstream fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connreset'));
    const res = await POST(makeRequest({ message: 'hi', page: '/' }));
    expect(res.status).toBe(502);
  });

  it('returns 502 when upstream responds non-ok', async () => {
    mockFetch.mockResolvedValueOnce(new Response('err', { status: 500 }));
    const res = await POST(makeRequest({ message: 'hi', page: '/' }));
    expect(res.status).toBe(502);
  });

  it('returns 502 when upstream JSON is unparseable', async () => {
    mockFetch.mockResolvedValueOnce(new Response('<<not json>>', { status: 200 }));
    const res = await POST(makeRequest({ message: 'hi', page: '/' }));
    expect(res.status).toBe(502);
  });

  it('returns 502 when model returns empty content', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: '   ' } }), { status: 200 }));
    const res = await POST(makeRequest({ message: 'hi', page: '/' }));
    expect(res.status).toBe(502);
  });

  it('builds LIVE DATA system content from db snapshot and includes it in the request', async () => {
    // Queue rows in the order Promise.allSettled fires them in buildContext:
    // [snap, allIndexers, recentEpochs, nameHits, portfolio, activity, topDelegators]
    dbResults.push([
      {
        current_epoch: 1247,
        indexer_count: 100,
        active_indexer_count: 80,
        total_staked: 1_000_000,
        total_delegated: 500_000,
        total_signalled: 200_000,
        total_allocated: 300_000,
        grt_price_usd: 0.15,
        delegator_count: 5000,
        active_delegator_count: 4000,
        subgraph_count: 900,
        active_subgraph_count: 800,
      },
    ]); // snap
    dbResults.push([]); // allIndexers
    dbResults.push([]); // recentEpochs
    // remaining promises resolve to [] by default

    const res = await POST(makeRequest({ message: 'network overview stats', page: '/' }));
    expect(res.status).toBe(200);
    const [, init] = mockFetch.mock.calls[0];
    const sent = JSON.parse(init.body as string);
    const systemMsg = sent.messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg.content).toContain('LIVE DATA:');
    expect(systemMsg.content).toContain('NETWORK (epoch 1247)');
  });

  it('trims history to the last 6 messages and prefixes the user message with /no_think', async () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg${i}`,
    }));
    await POST(makeRequest({ message: 'latest question', page: '/', history }));
    const [, init] = mockFetch.mock.calls[0];
    const sent = JSON.parse(init.body as string);
    // 1 system + 6 history + 1 user = 8
    expect(sent.messages.length).toBe(8);
    const last = sent.messages[sent.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toBe('/no_think latest question');
  });

  it('keeps short history intact (fewer than 6 messages)', async () => {
    const history = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ];
    await POST(makeRequest({ message: 'follow up', page: '/', history }));
    const [, init] = mockFetch.mock.calls[0];
    const sent = JSON.parse(init.body as string);
    // 1 system + 2 history + 1 user = 4
    expect(sent.messages.length).toBe(4);
    expect(sent.messages[1]).toEqual({ role: 'user', content: 'q1' });
    expect(sent.messages[2]).toEqual({ role: 'assistant', content: 'a1' });
  });

  it('handles a missing history field (no prior turns)', async () => {
    await POST(makeRequest({ message: 'standalone', page: '/' }));
    const [, init] = mockFetch.mock.calls[0];
    const sent = JSON.parse(init.body as string);
    // 1 system + 0 history + 1 user = 2
    expect(sent.messages.length).toBe(2);
    expect(sent.messages[0].role).toBe('system');
    expect(sent.messages[1].content).toBe('/no_think standalone');
  });

  it('renders the ALL INDEXERS section from db rows', async () => {
    dbResults.push([]); // snap
    dbResults.push([
      {
        name: 'Acme',
        ens_name: null,
        address: '0xabcdef0123',
        score: 90,
        score_grade: 'A',
        reward_cut: 10,
        query_fee_cut: 5,
        effective_cut: 8,
        delegator_apr: 12.5,
        self_stake_grt: 250000,
        delegated_grt: 1000000,
        allocated_grt: 800000,
        provisioned_grt: 900000,
        delegation_capacity_pct: 60,
        reo_status: 'eligible',
        reo_days_remaining: 30,
        net_flow_grt_7d: 50000,
        query_fees_collected_grt: 12345,
        allocation_count: 7,
      },
    ]); // allIndexers
    const res = await POST(makeRequest({ message: 'best indexers with highest reward', page: '/indexers' }));
    expect(res.status).toBe(200);
    const sent = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const system = sent.messages.find((m: { role: string }) => m.role === 'system').content;
    expect(system).toContain('ALL INDEXERS (1 total');
    expect(system).toContain('Acme(A)');
    expect(system).toContain('REO✓(30d)');
    expect(system).toContain('APY=12.5%');
  });

  it('renders RECENT EPOCHS from db rows', async () => {
    dbResults.push([]); // snap
    dbResults.push([]); // allIndexers
    dbResults.push([
      {
        id: 1247,
        total_rewards: 1000,
        total_indexer_rewards: 600,
        total_delegator_rewards: 400,
        total_query_fees: 50,
        query_fees_collected: 40,
        stake_deposited: 0,
        signalled_tokens: 0,
      },
    ]); // recentEpochs
    const res = await POST(makeRequest({ message: 'show me the last few epochs reward history', page: '/' }));
    expect(res.status).toBe(200);
    const sent = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const system = sent.messages.find((m: { role: string }) => m.role === 'system').content;
    expect(system).toContain('RECENT EPOCHS');
    expect(system).toContain('Epoch 1247');
  });

  it('renders an INDEXER SEARCH hit when a name lookup matches', async () => {
    dbResults.push([]); // snap
    dbResults.push([]); // allIndexers
    dbResults.push([]); // recentEpochs
    dbResults.push([
      {
        name: 'StakeSquid',
        ens_name: 'stakesquid.eth',
        address: '0x1',
        score_grade: 'B',
        reward_cut: 20,
        query_fee_cut: null,
        delegator_apr: 9,
        reo_status: 'eligible',
        reo_days_remaining: null,
        self_stake_grt: 100000,
        delegated_grt: 500000,
        allocation_count: 3,
        url: 'https://x.io',
      },
    ]); // nameHits
    const res = await POST(makeRequest({ message: 'tell me about stakesquid', page: '/' }));
    expect(res.status).toBe(200);
    const sent = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const system = sent.messages.find((m: { role: string }) => m.role === 'system').content;
    expect(system).toContain('INDEXER SEARCH "stakesquid"');
    expect(system).toContain('stakesquid.eth(B)');
    expect(system).toContain('url=https://x.io');
  });

  it('reports a no-match message when a name lookup finds nothing', async () => {
    dbResults.push([]); // snap
    dbResults.push([]); // allIndexers
    dbResults.push([]); // recentEpochs
    dbResults.push([]); // nameHits empty
    const res = await POST(makeRequest({ message: 'find nonexistentindexer', page: '/' }));
    expect(res.status).toBe(200);
    const sent = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const system = sent.messages.find((m: { role: string }) => m.role === 'system').content;
    expect(system).toContain('no matching indexers found');
  });

  it('renders YOUR WALLET portfolio rows when wallet + portfolio intent present', async () => {
    // db is only invoked for queries whose condition holds. With a portfolio
    // intent + wallet (and no name/activity/top intents) the calls are, in order:
    // snap, allIndexers, recentEpochs, portfolio.
    dbResults.push([]); // snap
    dbResults.push([]); // allIndexers
    dbResults.push([]); // recentEpochs
    dbResults.push([
      {
        staked_tokens: 100000,
        locked_tokens: 5000,
        locked_until: 0,
        address: '0xindexeraddr',
        name: 'MyIndexer',
        ens_name: null,
        reward_cut: 10,
        score_grade: 'A',
        reo_status: 'eligible',
        delegator_apr: 11,
        net_flow_grt_7d: 2000,
        score: 88,
      },
    ]); // portfolio
    const res = await POST(
      makeRequest({ message: 'how is my portfolio doing?', page: '/delegators', walletAddress: '0xWALLET1234' }),
    );
    expect(res.status).toBe(200);
    const sent = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const system = sent.messages.find((m: { role: string }) => m.role === 'system').content;
    expect(system).toContain('YOUR WALLET');
    expect(system).toContain('thawing=5000 GRT');
  });

  it('reports no active delegations when wallet present but portfolio rows empty', async () => {
    dbResults.push([]); // snap
    dbResults.push([]); // allIndexers
    dbResults.push([]); // recentEpochs
    dbResults.push([]); // nameHits
    dbResults.push([]); // portfolio empty
    const res = await POST(
      makeRequest({ message: 'my delegations', page: '/delegators', walletAddress: '0xWALLET1234' }),
    );
    expect(res.status).toBe(200);
    const sent = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const system = sent.messages.find((m: { role: string }) => m.role === 'system').content;
    expect(system).toContain('No active delegations');
  });

  it('renders TOP DELEGATORS and NETWORK ACTIVITY sections', async () => {
    // "biggest delegator whales" → top_delegators + indexers intents (no name,
    // no wallet). db calls in order: snap, allIndexers, recentEpochs, activity
    // (gated on the 'indexers' intent), topDelegators.
    dbResults.push([]); // snap
    dbResults.push([]); // allIndexers
    dbResults.push([]); // recentEpochs
    dbResults.push([
      { event_type: 'DELEGATED', count: 4, total_grt: 9000 },
      { event_type: 'UNDELEGATED', count: 2, total_grt: 3000 },
    ]); // activity
    dbResults.push([
      { delegator_address: '0xwhale', total_staked: 5000000, indexer_count: 3 },
    ]); // topDelegators
    const res = await POST(makeRequest({ message: 'who are the biggest delegator whales?', page: '/' }));
    expect(res.status).toBe(200);
    const sent = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const system = sent.messages.find((m: { role: string }) => m.role === 'system').content;
    expect(system).toContain('TOP DELEGATORS');
    expect(system).toContain('#1 0xwhale');
    expect(system).toContain('NETWORK ACTIVITY (last 7 days)');
    expect(system).toContain('4 delegations');
    expect(system).toContain('2 undelegations');
  });

  it('omits LIVE DATA entirely when db is unavailable (no context)', async () => {
    // Re-import the route module with db mocked to null so buildContext returns ''.
    vi.resetModules();
    vi.doMock('@/lib/db', () => ({ get db() { return null; } }));
    const mod = await import('@/app/api/lodie/chat/route');
    const POST2 = mod.POST as typeof POST;
    const res = await POST2(makeRequest({ message: 'anything', page: '/' }));
    expect(res.status).toBe(200);
    const sent = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const system = sent.messages.find((m: { role: string }) => m.role === 'system').content;
    expect(system).not.toContain('LIVE DATA:');
    vi.doUnmock('@/lib/db');
  });
});
