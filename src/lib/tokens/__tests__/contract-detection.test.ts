import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// classifyAddresses talks to chain RPCs via a viem PublicClient. We mock viem
// so getCode is fully controllable and never hits the network. The module
// caches results per-process, so we reset the module registry between tests.

const getCode = vi.fn();

vi.mock('viem', () => ({
  createPublicClient: vi.fn(() => ({ getCode })),
  fallback: vi.fn((t) => t),
  http: vi.fn((url) => url),
}));

vi.mock('viem/chains', () => ({
  mainnet: { id: 1 },
  arbitrum: { id: 42161 },
  base: { id: 8453 },
  polygon: { id: 137 },
  optimism: { id: 10 },
}));

beforeEach(() => {
  vi.resetModules();
  getCode.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

async function importFresh() {
  return await import('../contract-detection');
}

describe('classifyAddresses', () => {
  it('classifies bytecode as contract and 0x as EOA, lowercasing keys', async () => {
    getCode.mockImplementation(({ address }: { address: string }) =>
      address === '0xcontract' ? Promise.resolve('0x6080') : Promise.resolve('0x'),
    );
    const { classifyAddresses } = await importFresh();
    const out = await classifyAddresses('mainnet', ['0xCONTRACT', '0xEOA']);
    expect(out.get('0xcontract')).toBe(true);
    expect(out.get('0xeoa')).toBe(false);
  });

  it('treats a null code (EIP-1559 nodes that return undefined) as EOA', async () => {
    // viem returns undefined for empty accounts; the code coalesces to '0x'.
    getCode.mockResolvedValue(undefined);
    const { classifyAddresses } = await importFresh();
    const out = await classifyAddresses('mainnet', ['0xabc']);
    expect(out.get('0xabc')).toBe(false);
  });

  it('counts EIP-7702 delegation bytecode (0xef01...) as a contract', async () => {
    getCode.mockResolvedValue('0xef0100aabbcc');
    const { classifyAddresses } = await importFresh();
    const out = await classifyAddresses('mainnet', ['0xdelegated']);
    expect(out.get('0xdelegated')).toBe(true);
  });

  it('omits an address from the result map when the RPC fails after retry', async () => {
    vi.useFakeTimers();
    getCode.mockRejectedValue(new Error('header not found'));
    const { classifyAddresses } = await importFresh();
    const promise = classifyAddresses('mainnet', ['0xfail']);
    // Two attempts with a jittered backoff between them.
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out.has('0xfail')).toBe(false);
    expect(getCode).toHaveBeenCalledTimes(2);
  });

  it('retries once after a transient failure then succeeds', async () => {
    vi.useFakeTimers();
    getCode
      .mockRejectedValueOnce(new Error('internal error'))
      .mockResolvedValueOnce('0x6001');
    const { classifyAddresses } = await importFresh();
    const promise = classifyAddresses('mainnet', ['0xretry']);
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out.get('0xretry')).toBe(true);
    expect(getCode).toHaveBeenCalledTimes(2);
  });

  it('caches classified addresses so a repeat call makes no RPC request', async () => {
    getCode.mockResolvedValue('0x');
    const { classifyAddresses } = await importFresh();
    await classifyAddresses('mainnet', ['0xcached']);
    expect(getCode).toHaveBeenCalledTimes(1);
    const out = await classifyAddresses('mainnet', ['0xCACHED']);
    expect(out.get('0xcached')).toBe(false);
    // No further RPC calls — served from the process cache.
    expect(getCode).toHaveBeenCalledTimes(1);
  });

  it('returns an empty map for an empty address list without calling the RPC', async () => {
    const { classifyAddresses } = await importFresh();
    const out = await classifyAddresses('mainnet', []);
    expect(out.size).toBe(0);
    expect(getCode).not.toHaveBeenCalled();
  });

  it('does not cache failures, allowing a later successful re-classification', async () => {
    vi.useFakeTimers();
    getCode.mockRejectedValue(new Error('down'));
    const { classifyAddresses } = await importFresh();
    const p1 = classifyAddresses('mainnet', ['0xtransient']);
    await vi.runAllTimersAsync();
    await p1;
    expect(getCode).toHaveBeenCalledTimes(2);

    getCode.mockReset();
    getCode.mockResolvedValue('0x01');
    const out = await classifyAddresses('mainnet', ['0xtransient']);
    // Since the prior failure was not cached, the address is queried again.
    expect(out.get('0xtransient')).toBe(true);
    expect(getCode).toHaveBeenCalledTimes(1);
  });
});
