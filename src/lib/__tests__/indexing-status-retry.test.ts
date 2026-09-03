/**
 * `probeServing` retries a transport failure once before calling an indexer broken (RFC-006 D5
 * Fix D, lodestar#59). `broken` is load-bearing: on a one-indexer deployment it is the whole
 * "effectively dead" verdict, so one 5-second blip must not be sufficient evidence on its own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ssrf', () => ({ isSafeUrlResolved: async () => true, isSafeIndexerUrl: () => true }));
vi.mock('../tap', () => ({ hasTapSigner: () => false, signTapReceipt: async () => null }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { probeServing } from '../indexing-status';

const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
const okJson = () =>
  new Response('{"data":{"_meta":{"block":{"number":1}}}}', { status: 200, headers: { 'content-type': 'application/json' } });

describe('probeServing retry', () => {
  beforeEach(() => mockFetch.mockReset());

  it('10. a timeout followed by a good answer is servable, not broken', async () => {
    mockFetch.mockRejectedValueOnce(abortError()).mockResolvedValueOnce(okJson());
    const verdict = await probeServing('https://indexer.example', 'QmHash', undefined, 50);
    expect(verdict).not.toBe('broken');
    expect(verdict).toBe('alive_paid');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('11. two timeouts are broken, inside the bounded budget', async () => {
    mockFetch.mockRejectedValueOnce(abortError()).mockRejectedValueOnce(abortError());
    const t0 = Date.now();
    const verdict = await probeServing('https://indexer.example', 'QmHash', undefined, 50);
    const elapsed = Date.now() - t0;
    expect(verdict).toBe('broken');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // 1.6 × 50 ms of budget plus at most 300 ms of jitter; well under a second either way.
    expect(elapsed).toBeLessThan(1000);
  });

  it('classifies a response once and never retries it: a 5xx with a body is broken on the first attempt', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":"boom"}', { status: 500, headers: { 'content-type': 'application/json' } }));
    const verdict = await probeServing('https://indexer.example', 'QmHash', undefined, 50);
    expect(verdict).toBe('broken');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('a connection refused on the first attempt and a 402 on the second is alive', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce(new Response('Payment Required', { status: 402, headers: { 'content-type': 'text/plain' } }));
    expect(await probeServing('https://indexer.example', 'QmHash', undefined, 50)).toBe('alive_paid');
  });
});
