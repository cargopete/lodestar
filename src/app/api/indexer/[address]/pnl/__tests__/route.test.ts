/**
 * GET /api/indexer/[address]/pnl — revenue from our own RAV ingest, minus a cost model the
 * caller supplies in the query string.
 *
 * Every cost input arrives from an unauthenticated request, because there is no per-indexer
 * operator config yet. That makes the parsing the load-bearing part: a `NaN` or a negative that
 * slips through does not throw, it produces a P&L. The tests below pin that each malformed input
 * falls back to the documented default rather than reaching the computation.
 *
 * The `private, no-store` header matters for the same reason. The answer is shaped by the
 * caller's own cost assumptions, so a shared cache would serve one operator's margin to the next.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const hasDbAccess = vi.fn(() => true);
const db = vi.fn();
vi.mock('@/lib/db', () => ({
  hasDbAccess: () => hasDbAccess(),
  get db() {
    return hasDbAccess() ? (...a: unknown[]) => db(...a) : null;
  },
}));

const getIndexerRevenue = vi.fn();
vi.mock('@/lib/rav', () => ({
  getIndexerRevenue: (...a: unknown[]) => getIndexerRevenue(...a),
  REVENUE_WINDOWS: [7, 30, 90, 365],
}));

const resolveCostModel = vi.fn();
vi.mock('@/lib/infra-cost', () => ({
  resolveCostModel: (...a: unknown[]) => resolveCostModel(...a),
  DEFAULT_CHAIN_COSTS: { arbitrum: 1800, mainnet: 2400 },
}));

const computeIndexerPnl = vi.fn();
vi.mock('@/lib/pnl', () => ({ computeIndexerPnl: (...a: unknown[]) => computeIndexerPnl(...a) }));

vi.mock('@/lib/cache', () => ({
  cached: (_k: string, _t: number, f: () => Promise<unknown>) => f(),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } }));

import { GET } from '../route';

const ADDR = '0x0000000000000000000000000000000000000abc';

const call = (qs = '', address = ADDR) =>
  GET(new NextRequest(`http://localhost/api/indexer/${address}/pnl${qs}`), {
    params: Promise.resolve({ address }),
  });

/** The arguments the P&L computation was handed on the last call. */
const pnlArgs = () => computeIndexerPnl.mock.calls.at(-1)![0] as Record<string, unknown>;
const costArgs = () => resolveCostModel.mock.calls.at(-1)![0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  hasDbAccess.mockReturnValue(true);
  getIndexerRevenue.mockResolvedValue({ totalGRT: 100 });
  resolveCostModel.mockReturnValue({ monthlyUsd: 2100 });
  computeIndexerPnl.mockReturnValue({ netUsd: 42 });
});

describe('the guards', () => {
  it('400s a malformed address before touching the database', async () => {
    const res = await call('', 'not-an-address');
    expect(res.status).toBe(400);
    expect(getIndexerRevenue).not.toHaveBeenCalled();
  });

  it('accepts a checksummed address by lowercasing it', async () => {
    const res = await call('', '0x0000000000000000000000000000000000000ABC');
    expect(res.status).toBe(200);
    expect(getIndexerRevenue).toHaveBeenCalledWith(expect.anything(), ADDR, expect.anything());
  });

  it('503s when there is no database, rather than reporting a zero P&L', async () => {
    hasDbAccess.mockReturnValue(false);
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not configured/i);
  });
});

describe('the window', () => {
  it('defaults to 30 days', async () => {
    await call();
    expect(getIndexerRevenue).toHaveBeenCalledWith(
      expect.anything(),
      ADDR,
      { windowDays: 30, byDeployment: true },
    );
  });

  for (const w of [7, 30, 90, 365]) {
    it(`accepts the supported window ${w}`, async () => {
      await call(`?window=${w}`);
      expect(pnlArgs().windowDays).toBe(w);
    });
  }

  for (const bad of ['14', 'abc', '-7', '']) {
    it(`falls back to 30 for window="${bad}"`, async () => {
      await call(`?window=${bad}`);
      expect(pnlArgs().windowDays).toBe(30);
    });
  }
});

describe('the GRT price', () => {
  it('is null when absent, so the USD fields stay off', async () => {
    await call();
    expect(pnlArgs().grtPrice).toBeNull();
  });

  it('accepts zero, which is a real price to reason about', async () => {
    await call('?grtPrice=0');
    expect(pnlArgs().grtPrice).toBe(0);
  });

  it('accepts a decimal price', async () => {
    await call('?grtPrice=0.0925');
    expect(pnlArgs().grtPrice).toBe(0.0925);
  });

  for (const bad of ['-1', 'free', 'NaN', 'Infinity']) {
    it(`rejects grtPrice="${bad}" back to null`, async () => {
      await call(`?grtPrice=${bad}`);
      expect(pnlArgs().grtPrice).toBeNull();
    });
  }
});

describe('the cost model inputs', () => {
  it('passes no chains when none are named', async () => {
    await call();
    expect(costArgs()).toEqual({ chains: [], overrides: {}, baseOverheadUsd: undefined });
  });

  it('splits and trims the chain list, dropping empties', async () => {
    await call('?chains=arbitrum,%20mainnet%20,,base');
    expect(costArgs().chains).toEqual(['arbitrum', 'mainnet', 'base']);
  });

  it('collects cost_<chain> overrides by their suffix', async () => {
    await call('?cost_arbitrum=1800&cost_mainnet=0&window=30');
    expect(costArgs().overrides).toEqual({ arbitrum: 1800, mainnet: 0 });
  });

  it('drops a negative or non-numeric override rather than subtracting it', async () => {
    await call('?cost_arbitrum=-50&cost_base=lots&cost_mainnet=900');
    expect(costArgs().overrides).toEqual({ mainnet: 900 });
  });

  it('ignores query params that merely look adjacent', async () => {
    await call('?costarbitrum=99&cost=100');
    expect(costArgs().overrides).toEqual({});
  });

  it('accepts an overhead of zero and rejects a negative one', async () => {
    await call('?overhead=0');
    expect(costArgs().baseOverheadUsd).toBe(0);

    await call('?overhead=-300');
    expect(costArgs().baseOverheadUsd).toBeUndefined();
  });
});

describe('the answer', () => {
  it('returns the P&L, the resolved model and the defaults it was built from', async () => {
    const res = await call('?chains=arbitrum');
    const { data } = await res.json();

    expect(data.pnl).toEqual({ netUsd: 42 });
    expect(data.costModel).toEqual({ monthlyUsd: 2100 });
    expect(data.defaultChainCosts).toEqual({ arbitrum: 1800, mainnet: 2400 });
  });

  it('is never cached, because the caller\'s own assumptions shaped it', async () => {
    const res = await call();
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('500s when the revenue read fails', async () => {
    getIndexerRevenue.mockRejectedValue(new Error('pool exhausted'));
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/failed to compute/i);
  });
});
