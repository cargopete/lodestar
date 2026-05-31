/**
 * Security tests for /api/indexer/present-poi — input validation that prevents
 * GraphQL injection via deploymentId/allocationId, and SSRF guards on agentUrl.
 * Mocks isolated to this file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const VALID_DEPLOYMENT = 'Qm123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk'; // Qm + 44 base58
const VALID_ALLOCATION = '0x' + '1'.repeat(40);

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/indexer/present-poi', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function getPOST() {
  const mod = await import('@/app/api/indexer/present-poi/route');
  return mod.POST as (req: NextRequest) => Promise<Response>;
}

describe('/api/indexer/present-poi — input validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    process.env.INDEXER_AGENT_URL = 'https://agent.example.com';
  });

  it('400s when required fields are missing (no fetch)', async () => {
    const POST = await getPOST();
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects GraphQL-injection in deploymentId BEFORE any fetch', async () => {
    const POST = await getPOST();
    const malicious = 'Qm"}]) { id } evil(actions:[{type:cancel'; // breakout attempt
    const res = await POST(post({ deploymentId: malicious, allocationId: VALID_ALLOCATION }));
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects a non-hex allocationId', async () => {
    const POST = await getPOST();
    const res = await POST(post({ deploymentId: VALID_DEPLOYMENT, allocationId: '0xnothex' }));
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects an agentUrl pointing at a private/loopback host (SSRF)', async () => {
    const POST = await getPOST();
    for (const bad of [
      'http://127.0.0.1:8000',
      'http://localhost:8000',
      'http://169.254.169.254/latest/meta-data', // cloud metadata
      'http://[::1]:8000',
      'http://10.0.0.5',
      'file:///etc/passwd',
    ]) {
      const res = await POST(post({ deploymentId: VALID_DEPLOYMENT, allocationId: VALID_ALLOCATION, agentUrl: bad }));
      expect(res.status, `should reject ${bad}`).toBe(503);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('forwards to the agent for valid input', async () => {
    const POST = await getPOST();
    const res = await POST(post({ deploymentId: VALID_DEPLOYMENT, allocationId: VALID_ALLOCATION }));
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
