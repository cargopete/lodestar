/**
 * Tests for POST /api/subgraph-names - the nest guard must 503, not 200 { data: {} }, because
 * empty-and-successful is indistinguishable from "these subgraphs genuinely have no names" (#1097).
 * Names come from the gns nest's metadata hashes and IPFS (nuthatch#1160); the gateway path left
 * with the key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const displayNames = vi.fn<(hashes: string[]) => Promise<Record<string, string | null>>>();
const hasNuthatch = vi.fn(() => true);
vi.mock('@/lib/nuthatch', () => ({ hasNuthatch: () => hasNuthatch() }));
vi.mock('@/lib/subgraph-metadata', () => ({
  displayNamesForDeployments: (hashes: string[]) => displayNames(hashes),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn() } } }));

async function load() {
  const mod = await import('@/app/api/subgraph-names/route');
  return mod.POST as (req: NextRequest) => Promise<Response>;
}

function call(POST: Awaited<ReturnType<typeof load>>, hashes: unknown) {
  return POST(
    new NextRequest('http://localhost/api/subgraph-names', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hashes }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasNuthatch.mockReturnValue(true);
});

describe('/api/subgraph-names guards', () => {
  it('503 when no nest is configured', async () => {
    hasNuthatch.mockReturnValue(false);
    const POST = await load();
    const res = await call(POST, ['QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG']);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/Nuthatch is not configured/i);
    expect(json.data).toBeUndefined();
    expect(displayNames).not.toHaveBeenCalled();
  });
});

describe('/api/subgraph-names lookup', () => {
  it('maps ipfs hashes to display names', async () => {
    displayNames.mockResolvedValueOnce({
      QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG: 'Demo',
      QmNoName000000000000000000000000000000000000000: null,
    });
    const POST = await load();
    const res = await call(POST, ['QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG', 'QmNoName000000000000000000000000000000000000000']);
    expect(res.status).toBe(200);
    const json = await res.json();
    // A deployment with no name is left out rather than mapped to null.
    expect(json.data).toEqual({
      QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG: 'Demo',
    });
  });

  it('200 empty map when no usable hashes', async () => {
    const POST = await load();
    const res = await call(POST, ['not-a-cid']);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: {} });
    expect(displayNames).not.toHaveBeenCalled();
  });
});
