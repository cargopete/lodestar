import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock viem at the module boundary. createPublicClient is called at import time
// in reo-contract.ts, so we wire it to return a client backed by our spies.
const readContract = vi.fn();
const multicall = vi.fn();

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ readContract, multicall })),
    http: vi.fn(() => ({})),
  };
});

async function load() {
  return import('@/lib/reo-contract');
}

const A1 = '0x00000000000000000000000000000000000000A1';
const A2 = '0x00000000000000000000000000000000000000B2';

// 14-day eligibility period (seconds)
const PERIOD = 14 * 86400;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('reo-contract constants', () => {
  it('exposes the REO address and a view-only ABI', async () => {
    const { REO_ADDRESS, REO_ABI } = await load();
    expect(REO_ADDRESS).toBe('0x8ec2767a9d9ba02b4e09e8ff4fac2e14a340f304');
    // Every ABI entry must be a view function (no writes / admin surface)
    for (const entry of REO_ABI) {
      expect(entry.type).toBe('function');
      expect(entry.stateMutability).toBe('view');
    }
  });
});

describe('checkOracleEligibility', () => {
  it('parses an eligible indexer with positive days remaining', async () => {
    const { checkOracleEligibility } = await load();
    const now = Math.floor(Date.now() / 1000);
    const renewal = now - 86400; // renewed 1 day ago
    // Promise.all order: isEligible, renewalTime, period
    readContract
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(BigInt(renewal))
      .mockResolvedValueOnce(BigInt(PERIOD));

    const res = await checkOracleEligibility(A1);
    expect(res.address).toBe(A1.toLowerCase());
    expect(res.isEligible).toBe(true);
    expect(res.renewalTimestamp).toBe(renewal);
    expect(res.eligibilityPeriod).toBe(PERIOD);
    expect(res.expiresAt).toBe(renewal + PERIOD);
    // ~13 days remaining, rounded to one decimal
    expect(res.daysRemaining).toBeCloseTo(13, 0);
    expect(res.daysRemaining).toBeGreaterThan(0);
  });

  it('reports negative daysRemaining when eligibility has expired', async () => {
    const { checkOracleEligibility } = await load();
    const now = Math.floor(Date.now() / 1000);
    const renewal = now - PERIOD - 86400; // expired a day ago
    readContract
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(BigInt(renewal))
      .mockResolvedValueOnce(BigInt(PERIOD));

    const res = await checkOracleEligibility(A1);
    expect(res.isEligible).toBe(false);
    expect(res.daysRemaining).toBeLessThan(0);
  });

  it('lowercases the returned address regardless of input casing', async () => {
    const { checkOracleEligibility } = await load();
    readContract
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(BigInt(0))
      .mockResolvedValueOnce(BigInt(PERIOD));
    const res = await checkOracleEligibility(A1.toUpperCase());
    expect(res.address).toBe(A1.toLowerCase());
  });

  it('propagates an RPC error from readContract', async () => {
    const { checkOracleEligibility } = await load();
    readContract.mockRejectedValue(new Error('rpc down'));
    await expect(checkOracleEligibility(A1)).rejects.toThrow('rpc down');
  });
});

describe('batchCheckEligibility', () => {
  it('returns an empty map for no indexers without touching the RPC', async () => {
    const { batchCheckEligibility } = await load();
    const map = await batchCheckEligibility([]);
    expect(map.size).toBe(0);
    expect(readContract).not.toHaveBeenCalled();
    expect(multicall).not.toHaveBeenCalled();
  });

  it('maps successful multicall results keyed by lowercased address', async () => {
    const { batchCheckEligibility } = await load();
    const now = Math.floor(Date.now() / 1000);
    const renewal = now - 86400;
    readContract.mockResolvedValueOnce(BigInt(PERIOD)); // period
    multicall.mockResolvedValueOnce([
      { status: 'success', result: true },
      { status: 'success', result: BigInt(renewal) },
      { status: 'success', result: false },
      { status: 'success', result: BigInt(renewal) },
    ]);

    const map = await batchCheckEligibility([A1, A2]);
    expect(map.size).toBe(2);
    const e1 = map.get(A1.toLowerCase());
    expect(e1?.isEligible).toBe(true);
    expect(e1?.eligibilityPeriod).toBe(PERIOD);
    expect(e1?.expiresAt).toBe(renewal + PERIOD);
    expect(map.get(A2.toLowerCase())?.isEligible).toBe(false);
  });

  it('skips an indexer whose multicall reads failed', async () => {
    const { batchCheckEligibility } = await load();
    const now = Math.floor(Date.now() / 1000);
    readContract.mockResolvedValueOnce(BigInt(PERIOD));
    multicall.mockResolvedValueOnce([
      { status: 'success', result: true },
      { status: 'success', result: BigInt(now) },
      { status: 'failure', error: new Error('revert') },
      { status: 'success', result: BigInt(now) },
    ]);

    const map = await batchCheckEligibility([A1, A2]);
    expect(map.has(A1.toLowerCase())).toBe(true);
    expect(map.has(A2.toLowerCase())).toBe(false);
    expect(map.size).toBe(1);
  });

  it('skips when only the renewal read failed for an indexer', async () => {
    const { batchCheckEligibility } = await load();
    readContract.mockResolvedValueOnce(BigInt(PERIOD));
    multicall.mockResolvedValueOnce([
      { status: 'success', result: true },
      { status: 'failure', error: new Error('revert') },
    ]);
    const map = await batchCheckEligibility([A1]);
    expect(map.size).toBe(0);
  });
});

describe('getOracleStatus', () => {
  it('reports validation state and seconds since the last oracle update', async () => {
    const { getOracleStatus } = await load();
    const now = Math.floor(Date.now() / 1000);
    const lastUpdate = now - 3600; // updated an hour ago
    // Promise.all order: validation, lastUpdate, period
    readContract
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(BigInt(lastUpdate))
      .mockResolvedValueOnce(BigInt(PERIOD));

    const status = await getOracleStatus();
    expect(status.validationEnabled).toBe(true);
    expect(status.lastOracleUpdate).toBe(lastUpdate);
    expect(status.secondsSinceUpdate).toBeGreaterThanOrEqual(3600);
    expect(status.secondsSinceUpdate).toBeLessThan(3600 + 10);
    expect(status.eligibilityPeriodDays).toBe(14);
  });

  it('reflects validation disabled', async () => {
    const { getOracleStatus } = await load();
    const now = Math.floor(Date.now() / 1000);
    readContract
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(BigInt(now))
      .mockResolvedValueOnce(BigInt(PERIOD));
    const status = await getOracleStatus();
    expect(status.validationEnabled).toBe(false);
  });
});
