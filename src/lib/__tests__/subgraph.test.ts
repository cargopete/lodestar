import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// SUBGRAPH_URL et al. are computed once at module-load time from
// process.env.GRAPH_API_KEY, so we must set the env BEFORE importing the
// module under test. We use dynamic import inside each block (after resetting
// modules) so the with-key and without-key paths get distinct module states.

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ORIGINAL_KEY = process.env.GRAPH_API_KEY;

afterEach(() => {
  process.env.GRAPH_API_KEY = ORIGINAL_KEY;
  vi.resetModules();
});

describe('subgraph: with GRAPH_API_KEY configured', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.GRAPH_API_KEY = 'test-key-123';
    vi.resetModules();
  });

  it('hasSubgraphAccess returns true', async () => {
    const mod = await import('@/lib/subgraph');
    expect(mod.hasSubgraphAccess()).toBe(true);
  });

  it('subgraphQuery POSTs the query and unwraps data', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: { indexers: [{ id: '0x1' }] } }));
    const mod = await import('@/lib/subgraph');
    const result = await mod.subgraphQuery<{ indexers: { id: string }[] }>('{ indexers { id } }');

    expect(result).toEqual({ indexers: [{ id: '0x1' }] });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('test-key-123');
    expect(url).toContain('/subgraphs/id/');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ query: '{ indexers { id } }' });
  });

  it('subgraphQuery throws on non-ok HTTP status', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 502));
    const mod = await import('@/lib/subgraph');
    await expect(mod.subgraphQuery('{ x }')).rejects.toThrow('Subgraph request failed: 502');
  });

  it('subgraphQuery throws on GraphQL errors array', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse({ errors: [{ message: 'bad field' }] })));
    const mod = await import('@/lib/subgraph');
    await expect(mod.subgraphQuery('{ x }')).rejects.toThrow(/GraphQL errors/);
    await expect(mod.subgraphQuery('{ x }')).rejects.toThrow(/bad field/);
  });

  it('ensQuery hits a distinct ENS subgraph endpoint and unwraps data', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: { domains: [{ name: 'foo.eth' }] } }));
    const mod = await import('@/lib/subgraph');
    const res = await mod.ensQuery<{ domains: { name: string }[] }>('{ domains { name } }');
    expect(res.domains[0].name).toBe('foo.eth');
    expect(mockFetch.mock.calls[0][0]).toContain('5XqPmWe6gjyrJtFn9cLy237i4cWw2j9HcUJEXsP5qGtH');
  });

  it('ensQuery surfaces GraphQL errors', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ errors: [{ message: 'ens boom' }] }));
    const mod = await import('@/lib/subgraph');
    await expect(mod.ensQuery('{ x }')).rejects.toThrow(/ens boom/);
  });

  it('delegationEventsQuery hits the delegation-events endpoint', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: { delegationEvents: [] } }));
    const mod = await import('@/lib/subgraph');
    const res = await mod.delegationEventsQuery<{ delegationEvents: unknown[] }>('{ delegationEvents { id } }');
    expect(res.delegationEvents).toEqual([]);
    expect(mockFetch.mock.calls[0][0]).toContain('4LLzwGxX6iBgXzAe4Sp9pEUg6n5h3UTMviAYKPmuUWds');
  });

  it('delegationEventsQuery throws on non-ok status with its own message', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 500));
    const mod = await import('@/lib/subgraph');
    await expect(mod.delegationEventsQuery('{ x }')).rejects.toThrow(
      'Delegation events subgraph request failed: 500'
    );
  });

  it('horizonPerfQuery and qosOracleQuery target their own endpoints', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse({ data: { ok: true } })));
    const mod = await import('@/lib/subgraph');
    await mod.horizonPerfQuery('{ a }');
    await mod.qosOracleQuery('{ b }');
    expect(mockFetch.mock.calls[0][0]).toContain('eD1TVayj2NtmCjWFr4hZhc1APHQs9iR2Xah6KNE8Y4h');
    expect(mockFetch.mock.calls[1][0]).toContain('Dtr9rETvwokot4BSXaD5tECanXfqfJKcvHuaaEgPDD2D');
  });
});

describe('subgraph: without GRAPH_API_KEY', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    delete process.env.GRAPH_API_KEY;
    vi.resetModules();
  });

  it('hasSubgraphAccess returns false', async () => {
    const mod = await import('@/lib/subgraph');
    expect(mod.hasSubgraphAccess()).toBe(false);
  });

  it('subgraphQuery throws without making a network call', async () => {
    const mod = await import('@/lib/subgraph');
    await expect(mod.subgraphQuery('{ x }')).rejects.toThrow('GRAPH_API_KEY not configured');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('ensQuery / delegationEventsQuery / dispatchRegistryQuery all fail closed', async () => {
    const mod = await import('@/lib/subgraph');
    await expect(mod.ensQuery('{ x }')).rejects.toThrow('GRAPH_API_KEY not configured');
    await expect(mod.delegationEventsQuery('{ x }')).rejects.toThrow('GRAPH_API_KEY not configured');
    await expect(mod.dispatchRegistryQuery('{ x }')).rejects.toThrow('GRAPH_API_KEY not configured');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
