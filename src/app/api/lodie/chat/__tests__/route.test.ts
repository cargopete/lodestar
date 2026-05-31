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
});
