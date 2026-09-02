/**
 * GET /api/operator-preflight — "what would happen if this address tried to run this service".
 *
 * The answer is a list of steps with a verdict on top, and someone reads it to decide whether to
 * spend money. That makes one failure mode much worse than the others: a preflight that could not
 * run must never render as a preflight that found nothing wrong. Hence the 500 on any read
 * failure, and hence a test for it rather than a shrug at the catch block.
 *
 * The registration check is the other piece worth pinning. It compares an address the caller
 * supplied against addresses from the registry, and those two agree on case only by accident.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createPublicClient = vi.fn(() => ({ __client: true }));
vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: (...a: unknown[]) => createPublicClient(...(a as [])),
    http: (url?: string) => ({ __transport: url }),
  };
});

const runCensus = vi.fn();
vi.mock('@/lib/service-census', () => ({
  runCensus: () => runCensus(),
  CENSUS_SERVICES: [
    { id: 'dispatch', name: 'Dispatch', address: '0x7101d5c1a5c89c3647f5118da118e56c023ba0b9', probe: 'jsonrpc' },
    { id: 'seahorn', name: 'Seahorn', address: '0xdDE3F913cb6D1332Bc018Eb63647020a87dD7B37', probe: 'http' },
  ],
}));

const readRequirements = vi.fn();
const toJson = vi.fn((r: unknown) => ({ json: r }));
vi.mock('@/lib/operator-requirements', () => ({
  readRequirements: (...a: unknown[]) => readRequirements(...a),
  toJson: (r: unknown) => toJson(r),
}));

const readPreflight = vi.fn();
const preflight = vi.fn();
const preflightVerdict = vi.fn();
vi.mock('@/lib/operator-preflight', () => ({
  readPreflight: (...a: unknown[]) => readPreflight(...a),
  preflight: (...a: unknown[]) => preflight(...a),
  preflightVerdict: (...a: unknown[]) => preflightVerdict(...a),
}));

vi.mock('@/lib/cache', () => ({
  cached: (_k: string, _t: number, f: () => Promise<unknown>) => f(),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } }));

import { GET } from '../route';

const ADDR = '0x1111111111111111111111111111111111111111';
const STEPS = [{ id: 'stake', ok: true }];

const call = (qs: string) => GET(new Request(`http://localhost/api/operator-preflight${qs}`));
const body = async (qs: string) => (await call(qs)).json();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ARBITRUM_RPC_URL', 'https://arb.example/rpc');
  readPreflight.mockResolvedValue({ stake: 100n });
  readRequirements.mockResolvedValue({ minStake: 1n });
  runCensus.mockResolvedValue([{ id: 'dispatch', providers: [] }]);
  preflight.mockReturnValue(STEPS);
  preflightVerdict.mockReturnValue('ready');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the query guards', () => {
  it('400s a missing address', async () => {
    const res = await call('?service=dispatch');
    expect(res.status).toBe(400);
    expect(readPreflight).not.toHaveBeenCalled();
  });

  it('400s an address that is not one', async () => {
    expect((await call('?address=0xnope&service=dispatch')).status).toBe(400);
  });

  it('400s an unknown service, naming the ones that exist', async () => {
    const res = await call(`?address=${ADDR}&service=nonesuch`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/dispatch, seahorn/);
  });

  it('400s a missing service', async () => {
    expect((await call(`?address=${ADDR}`)).status).toBe(400);
  });

  it('tolerates surrounding whitespace in both params', async () => {
    const res = await call(`?address=%20${ADDR}%20&service=%20dispatch%20`);
    expect(res.status).toBe(200);
  });
});

describe('the reads', () => {
  it('reads the caller\'s position, the service requirements and the census together', async () => {
    await call(`?address=${ADDR}&service=dispatch`);

    expect(readPreflight).toHaveBeenCalledWith(
      { __client: true },
      ADDR,
      '0x7101d5c1a5c89c3647f5118da118e56c023ba0b9',
    );
    expect(readRequirements).toHaveBeenCalledWith(
      { __client: true },
      '0x7101d5c1a5c89c3647f5118da118e56c023ba0b9',
    );
    expect(runCensus).toHaveBeenCalledTimes(1);
  });

  it('reports registered regardless of the case each side spells the address in', async () => {
    runCensus.mockResolvedValue([
      { id: 'dispatch', providers: [{ address: ADDR.toUpperCase().replace('0X', '0x') }] },
    ]);

    await call(`?address=${ADDR}&service=dispatch`);
    expect(preflight).toHaveBeenCalledWith(expect.objectContaining({ registered: true }));
  });

  it('reports not registered when the census lists other providers', async () => {
    runCensus.mockResolvedValue([
      { id: 'dispatch', providers: [{ address: '0x2222222222222222222222222222222222222222' }] },
    ]);

    await call(`?address=${ADDR}&service=dispatch`);
    expect(preflight).toHaveBeenCalledWith(expect.objectContaining({ registered: false }));
  });

  it('reports not registered when the census has no entry for the service at all', async () => {
    runCensus.mockResolvedValue([]);
    await call(`?address=${ADDR}&service=seahorn`);
    expect(preflight).toHaveBeenCalledWith(expect.objectContaining({ registered: false }));
  });

  it('passes the requirements through as null when the service declares none', async () => {
    readRequirements.mockResolvedValue(null);
    await call(`?address=${ADDR}&service=dispatch`);
    expect(preflight).toHaveBeenCalledWith(expect.objectContaining({ requirements: null }));
    expect(toJson).not.toHaveBeenCalled();
  });
});

describe('the answer', () => {
  it('carries the verdict, the steps and the service it was asked about', async () => {
    const { data } = await body(`?address=${ADDR}&service=seahorn`);

    expect(data.address).toBe(ADDR);
    expect(data.service).toEqual({
      id: 'seahorn',
      name: 'Seahorn',
      address: '0xdDE3F913cb6D1332Bc018Eb63647020a87dD7B37',
    });
    expect(data.verdict).toBe('ready');
    expect(data.steps).toEqual(STEPS);
    expect(preflightVerdict).toHaveBeenCalledWith(STEPS);
  });

  it('is briefly cacheable — the same address and service give the same answer', async () => {
    const res = await call(`?address=${ADDR}&service=dispatch`);
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=60, stale-while-revalidate=300');
  });
});

describe('when it cannot run', () => {
  it('500s rather than reporting a clean preflight when the RPC is not configured', async () => {
    vi.stubEnv('ARBITRUM_RPC_URL', '');
    const res = await call(`?address=${ADDR}&service=dispatch`);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Preflight failed');
  });

  it('500s when a chain read fails', async () => {
    readPreflight.mockRejectedValue(new Error('rpc timeout'));
    expect((await call(`?address=${ADDR}&service=dispatch`)).status).toBe(500);
  });

  it('500s when the census fails', async () => {
    runCensus.mockRejectedValue(new Error('registry unreachable'));
    expect((await call(`?address=${ADDR}&service=dispatch`)).status).toBe(500);
  });
});
