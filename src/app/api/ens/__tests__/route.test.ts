/**
 * GET /api/ens — the primary name over a mainnet RPC (nuthatch#1160), and the catch-all must 503,
 * not 200 { ensName: null }.
 *
 * "We could not look this up" and "this address has no ENS name" are different answers, and a
 * successful null makes them the same one (#36, following #28 next door). `useENSName` already
 * falls back to null on a non-OK response, so the screen is unchanged and only the route becomes
 * honest about which of the two it means.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const resolveEnsName = vi.fn();
vi.mock('@/lib/ens', () => ({
  resolveEnsName: (...a: unknown[]) => resolveEnsName(...a),
}));
const hasSubgraphAccess = vi.fn(() => true);
vi.mock('@/lib/subgraph', () => ({
  hasSubgraphAccess: () => hasSubgraphAccess(),
  ensQuery: vi.fn(),
}));
vi.mock('@/lib/cache', () => ({
  cached: (_k: string, _t: number, f: () => Promise<unknown>) => f(),
}));

import { GET } from '../route';

const ADDR = '0x1234567890abcdef1234567890abcdef12345678';

const call = (address?: string) =>
  GET(
    new NextRequest(
      `http://localhost/api/ens${address === undefined ? '' : `?address=${address}`}`,
    ),
  );

beforeEach(() => {
  vi.clearAllMocks();
  hasSubgraphAccess.mockReturnValue(true);
});

describe('/api/ens', () => {
  it('400s when no address is given', async () => {
    const res = await call();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/address required/i);
  });

  it('never consults the gateway key: the name comes from a mainnet RPC (nuthatch#1160)', async () => {
    hasSubgraphAccess.mockReturnValue(false);
    resolveEnsName.mockResolvedValue('pete.eth');
    const res = await call(ADDR);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ensName: 'pete.eth' });
    expect(hasSubgraphAccess).not.toHaveBeenCalled();
  });

  it('503s when the lookup itself fails', async () => {
    resolveEnsName.mockRejectedValue(new Error('rpc down'));
    const res = await call(ADDR);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/lookup failed/i);
  });

  it('returns the primary name when one is set', async () => {
    resolveEnsName.mockResolvedValue('vitalik.eth');
    const res = await call(ADDR);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ensName: 'vitalik.eth' });
  });

  it('reports a genuine absence as a successful null', async () => {
    // The case the 503 above exists to stay distinguishable from.
    resolveEnsName.mockResolvedValue(null);
    const res = await call(ADDR);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ensName: null });
  });

  it('answers a non-address with a successful null rather than looking it up', async () => {
    const res = await call('not-an-address');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ensName: null });
    expect(resolveEnsName).not.toHaveBeenCalled();
  });

  it('lower-cases the address before resolving', async () => {
    resolveEnsName.mockResolvedValue(null);
    await call('0xABCDEF7890ABCDEF1234567890ABCDEF12345678');
    expect(resolveEnsName.mock.calls[0][0]).toBe('0xabcdef7890abcdef1234567890abcdef12345678');
  });
});
