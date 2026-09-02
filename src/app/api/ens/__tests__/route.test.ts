/**
 * GET /api/ens — the access guard and the catch-all must 503, not 200 { ensName: null }.
 *
 * "We could not look this up" and "this address has no ENS name" are different answers, and a
 * successful null makes them the same one (#36, following #28 next door). `useENSName` already
 * falls back to null on a non-OK response, so the screen is unchanged and only the route becomes
 * honest about which of the two it means.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const ensQuery = vi.fn();
const hasSubgraphAccess = vi.fn(() => true);
vi.mock('@/lib/subgraph', () => ({
  ensQuery: (...a: unknown[]) => ensQuery(...a),
  hasSubgraphAccess: () => hasSubgraphAccess(),
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

  it('503s when there is no gateway key, without querying', async () => {
    hasSubgraphAccess.mockReturnValue(false);
    const res = await call(ADDR);

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/No API key/i);
    expect(json.ensName).toBeUndefined();
    expect(ensQuery).not.toHaveBeenCalled();
  });

  it('503s when the lookup itself fails', async () => {
    ensQuery.mockRejectedValue(new Error('gateway down'));
    const res = await call(ADDR);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/lookup failed/i);
  });

  it('returns the name when one resolves', async () => {
    ensQuery.mockResolvedValue({ domains: [{ name: 'vitalik.eth' }] });
    const res = await call(ADDR);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ensName: 'vitalik.eth' });
  });

  it('prefers the shortest name, so a primary beats its subdomains', async () => {
    ensQuery.mockResolvedValue({
      domains: [{ name: 'wallet.pete.eth' }, { name: 'pete.eth' }, { name: 'a.b.pete.eth' }],
    });
    const res = await call(ADDR);
    expect((await res.json()).ensName).toBe('pete.eth');
  });

  it('reports a genuine absence as a successful null', async () => {
    // The case the 503s above exist to stay distinguishable from.
    ensQuery.mockResolvedValue({ domains: [] });
    const res = await call(ADDR);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ensName: null });
  });

  it('answers a non-address with a successful null rather than looking it up', async () => {
    const res = await call('not-an-address');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ensName: null });
    expect(ensQuery).not.toHaveBeenCalled();
  });

  it('lower-cases the address before querying', async () => {
    ensQuery.mockResolvedValue({ domains: [] });
    await call('0xABCDEF7890ABCDEF1234567890ABCDEF12345678');
    expect(ensQuery.mock.calls[0][0]).toContain('0xabcdef7890abcdef1234567890abcdef12345678');
  });
});
