/**
 * Tests for the metered query gateway POST /api/gateway/<key>.
 * Mocks the api-key crypto, the studio usage/db helpers, hasDbAccess and fetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/studio/api-keys', () => ({
  hashApiKey: vi.fn((k: string) => `hash:${k}`),
  isValidApiKeyFormat: vi.fn((k: string) => /^lod_live_[0-9a-f]{48}$/.test(k)),
}));

vi.mock('@/lib/db', () => ({
  hasDbAccess: vi.fn(() => true),
}));

vi.mock('@/lib/studio/db', () => ({
  findApiKeyByHash: vi.fn(),
  getGlobalUsage: vi.fn(),
  getOwnerUsage: vi.fn(),
  incrementKeyUsage: vi.fn(),
}));

import * as apiKeys from '@/lib/studio/api-keys';
import * as db from '@/lib/db';
import * as studioDb from '@/lib/studio/db';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const VALID_KEY = 'lod_live_' + 'a'.repeat(48);
const VALID_DEPLOYMENT = 'Qm' + '1'.repeat(44);
const VALID_SUBGRAPH = '0x' + 'a'.repeat(64);
const ACTIVE_RECORD = { id: 7, owner_address: '0xowner', status: 'active' };

function post(key: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/gateway/${key}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function callPOST(key: string, body: unknown) {
  const mod = await import('@/app/api/gateway/[key]/route');
  return mod.POST(post(key, body), { params: Promise.resolve({ key }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GRAPH_API_KEY = 'test-graph-key';
  process.env.GATEWAY_FREE_TIER_PER_USER = '5000';
  process.env.GATEWAY_FREE_TIER_GLOBAL = '90000';
  vi.mocked(db.hasDbAccess).mockReturnValue(true);
  vi.mocked(apiKeys.isValidApiKeyFormat).mockImplementation((k: string) => /^lod_live_[0-9a-f]{48}$/.test(k));
  vi.mocked(studioDb.findApiKeyByHash).mockResolvedValue(ACTIVE_RECORD);
  vi.mocked(studioDb.getOwnerUsage).mockResolvedValue(0);
  vi.mocked(studioDb.getGlobalUsage).mockResolvedValue(0);
  mockFetch.mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));
});

describe('gateway POST — auth', () => {
  it('401s on an invalid key format before touching the DB', async () => {
    const res = await callPOST('not-a-key', { deployment: VALID_DEPLOYMENT, query: '{ a }' });
    expect(res.status).toBe(401);
    expect(studioDb.findApiKeyByHash).not.toHaveBeenCalled();
  });

  it('503s when DB is unavailable', async () => {
    vi.mocked(db.hasDbAccess).mockReturnValue(false);
    const res = await callPOST(VALID_KEY, { deployment: VALID_DEPLOYMENT, query: '{ a }' });
    expect(res.status).toBe(503);
  });

  it('401s when the key is unknown', async () => {
    vi.mocked(studioDb.findApiKeyByHash).mockResolvedValue(null);
    const res = await callPOST(VALID_KEY, { deployment: VALID_DEPLOYMENT, query: '{ a }' });
    expect(res.status).toBe(401);
  });

  it('401s when the key is revoked', async () => {
    vi.mocked(studioDb.findApiKeyByHash).mockResolvedValue({ ...ACTIVE_RECORD, status: 'revoked' });
    const res = await callPOST(VALID_KEY, { deployment: VALID_DEPLOYMENT, query: '{ a }' });
    expect(res.status).toBe(401);
  });
});

describe('gateway POST — free-tier limits enforced before forwarding', () => {
  it('429s on per-user quota and never forwards', async () => {
    vi.mocked(studioDb.getOwnerUsage).mockResolvedValue(5000);
    const res = await callPOST(VALID_KEY, { deployment: VALID_DEPLOYMENT, query: '{ a }' });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.limit).toBe(5000);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(studioDb.incrementKeyUsage).not.toHaveBeenCalled();
  });

  it('429s on global ceiling and never forwards', async () => {
    vi.mocked(studioDb.getGlobalUsage).mockResolvedValue(90000);
    const res = await callPOST(VALID_KEY, { deployment: VALID_DEPLOYMENT, query: '{ a }' });
    expect(res.status).toBe(429);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('gateway POST — body + identifier validation', () => {
  it('400s on an invalid JSON body', async () => {
    const req = new NextRequest(`http://localhost:3000/api/gateway/${VALID_KEY}`, {
      method: 'POST',
      body: 'not json',
    });
    const mod = await import('@/app/api/gateway/[key]/route');
    const res = await mod.POST(req, { params: Promise.resolve({ key: VALID_KEY }) });
    expect(res.status).toBe(400);
  });

  it('400s when query is missing', async () => {
    const res = await callPOST(VALID_KEY, { deployment: VALID_DEPLOYMENT });
    expect(res.status).toBe(400);
  });

  it('400s when neither deployment nor subgraphId is provided', async () => {
    const res = await callPOST(VALID_KEY, { query: '{ a }' });
    expect(res.status).toBe(400);
  });

  it('400s when both deployment and subgraphId are provided', async () => {
    const res = await callPOST(VALID_KEY, { deployment: VALID_DEPLOYMENT, subgraphId: VALID_SUBGRAPH, query: '{ a }' });
    expect(res.status).toBe(400);
  });

  it('400s on a path-injection deployment id and never forwards', async () => {
    const res = await callPOST(VALID_KEY, { deployment: '../../evil', query: '{ a }' });
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('400s on a malformed subgraphId', async () => {
    const res = await callPOST(VALID_KEY, { subgraphId: '0xdeadbeef', query: '{ a }' });
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('gateway POST — forwarding and metering', () => {
  it('forwards to the deployment URL and meters only on upstream.ok', async () => {
    const res = await callPOST(VALID_KEY, { deployment: VALID_DEPLOYMENT, query: '{ a }', variables: { x: 1 } });
    expect(res.status).toBe(200);

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/deployments/id/${VALID_DEPLOYMENT}`);
    expect(JSON.parse(opts.body as string)).toEqual({ query: '{ a }', variables: { x: 1 } });
    expect(studioDb.incrementKeyUsage).toHaveBeenCalledWith(ACTIVE_RECORD.id, expect.any(String));
  });

  it('builds the subgraphId URL when subgraphId is given', async () => {
    await callPOST(VALID_KEY, { subgraphId: VALID_SUBGRAPH, query: '{ a }' });
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain(`/subgraphs/id/${VALID_SUBGRAPH}`);
  });

  it('does NOT meter when the upstream returns a non-ok status, and mirrors that status', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ errors: ['bad'] }), { status: 400 }));
    const res = await callPOST(VALID_KEY, { deployment: VALID_DEPLOYMENT, query: '{ a }' });
    expect(res.status).toBe(400);
    expect(studioDb.incrementKeyUsage).not.toHaveBeenCalled();
  });

  it('502s when the upstream fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('connection reset'));
    const res = await callPOST(VALID_KEY, { deployment: VALID_DEPLOYMENT, query: '{ a }' });
    expect(res.status).toBe(502);
    expect(studioDb.incrementKeyUsage).not.toHaveBeenCalled();
  });
});
