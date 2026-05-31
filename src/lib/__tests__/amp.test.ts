import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// node:http / node:https boundary mocks.
// ampQuery uses node:http(s).request directly (NOT fetch) to force HTTP/1.1.
// We mock request() to drive a fake IncomingMessage through data/end events.
// ---------------------------------------------------------------------------

interface FakeResponse {
  statusCode?: number;
  chunks?: string[];
}

const httpsRequest = vi.fn();
const httpRequest = vi.fn();

vi.mock('node:https', () => ({
  // Constructable stub for `new https.Agent(...)`.
  Agent: function Agent(this: Record<string, unknown>, opts?: unknown) {
    this.opts = opts;
  },
  request: (...args: unknown[]) =>
    (httpsRequest as (...a: unknown[]) => unknown)(...args),
}));

vi.mock('node:http', () => ({
  Agent: function Agent(this: Record<string, unknown>, opts?: unknown) {
    this.opts = opts;
  },
  request: (...args: unknown[]) =>
    (httpRequest as (...a: unknown[]) => unknown)(...args),
}));

/** Build a request() implementation that emits the given fake response. */
function makeRequestImpl(resp: FakeResponse) {
  return (_options: unknown, cb: (res: EventEmitter) => void) => {
    const req = new EventEmitter() as EventEmitter & {
      write: () => void;
      end: () => void;
      destroy: () => void;
    };
    req.write = vi.fn();
    req.end = vi.fn(() => {
      // Deliver the response after the caller has wired its listeners.
      const res = new EventEmitter() as EventEmitter & {
        statusCode?: number;
        setEncoding: (enc: string) => void;
      };
      res.statusCode = resp.statusCode ?? 200;
      res.setEncoding = vi.fn();
      cb(res);
      for (const chunk of resp.chunks ?? []) {
        res.emit('data', chunk);
      }
      res.emit('end');
    });
    req.destroy = vi.fn();
    return req;
  };
}

describe('amp pure helpers', () => {
  it('strip0x removes a leading 0x and leaves bare hex untouched', async () => {
    const { strip0x } = await import('@/lib/amp');
    expect(strip0x('0xdeadBEEF')).toBe('deadBEEF');
    expect(strip0x('deadbeef')).toBe('deadbeef');
    expect(strip0x('0x')).toBe('');
    expect(strip0x('')).toBe('');
  });

  it('hexLit wraps stripped hex in an ampd X\'...\' binary literal', async () => {
    const { hexLit } = await import('@/lib/amp');
    expect(hexLit('0xabc123')).toBe("X'abc123'");
    expect(hexLit('abc123')).toBe("X'abc123'");
    expect(hexLit('0x')).toBe("X''");
  });

  it('topicToAddress extracts the last 20 bytes from a padded 32-byte topic', async () => {
    const { topicToAddress } = await import('@/lib/amp');
    const topic =
      '0x000000000000000000000000aabbccddeeff00112233445566778899aabbccdd';
    expect(topicToAddress(topic)).toBe('0xaabbccddeeff00112233445566778899aabbccdd');
    // result is always 0x + 40 chars
    expect(topicToAddress(topic)).toHaveLength(42);
  });

  it('topicToAddress works without a 0x prefix too', async () => {
    const { topicToAddress } = await import('@/lib/amp');
    const topic =
      '000000000000000000000000aabbccddeeff00112233445566778899aabbccdd';
    expect(topicToAddress(topic)).toBe('0xaabbccddeeff00112233445566778899aabbccdd');
  });

  it('hexToBigInt decodes both prefixed and unprefixed hex', async () => {
    const { hexToBigInt } = await import('@/lib/amp');
    expect(hexToBigInt('0x0a')).toBe(10n);
    expect(hexToBigInt('ff')).toBe(255n);
    expect(hexToBigInt('0x00')).toBe(0n);
    const big = '0x' + 'f'.repeat(64);
    expect(hexToBigInt(big)).toBe((1n << 256n) - 1n);
  });

  it('exposes the expected static contract constants', async () => {
    const { HORIZON_STAKING, AMP_DATASET, TOPIC0 } = await import('@/lib/amp');
    expect(HORIZON_STAKING).toMatch(/^0x[0-9a-f]{40}$/);
    expect(AMP_DATASET).toBe('"_/arbitrum_one@1.0.0"');
    // Every topic0 is a 32-byte keccak hash.
    for (const v of Object.values(TOPIC0)) {
      expect(v).toMatch(/^0x[0-9a-f]{64}$/);
    }
    // Distinct signatures must hash distinctly.
    const vals = Object.values(TOPIC0);
    expect(new Set(vals).size).toBe(vals.length);
  });
});

describe('hasAmpAccess', () => {
  const ENV = process.env;
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ENV };
  });
  afterEach(() => {
    process.env = ENV;
  });

  it('is false when neither var is set', async () => {
    delete process.env.AMP_ENDPOINT;
    delete process.env.AMP_TOKEN;
    const { hasAmpAccess } = await import('@/lib/amp');
    expect(hasAmpAccess()).toBe(false);
  });

  it('is false when only one var is set', async () => {
    process.env.AMP_ENDPOINT = 'http://127.0.0.1:1603';
    delete process.env.AMP_TOKEN;
    const { hasAmpAccess } = await import('@/lib/amp');
    expect(hasAmpAccess()).toBe(false);
  });

  it('is true when both are set', async () => {
    process.env.AMP_ENDPOINT = 'http://127.0.0.1:1603';
    process.env.AMP_TOKEN = 'sekret';
    const { hasAmpAccess } = await import('@/lib/amp');
    expect(hasAmpAccess()).toBe(true);
  });
});

describe('ampQuery', () => {
  const ENV = process.env;
  beforeEach(() => {
    vi.resetModules();
    httpsRequest.mockReset();
    httpRequest.mockReset();
    process.env = { ...ENV };
  });
  afterEach(() => {
    process.env = ENV;
  });

  it('throws AmpError when endpoint/token are not configured', async () => {
    delete process.env.AMP_ENDPOINT;
    delete process.env.AMP_TOKEN;
    const { ampQuery, AmpError } = await import('@/lib/amp');
    // The config guard runs synchronously before the Promise is constructed.
    expect(() => ampQuery('SELECT 1')).toThrow(AmpError);
    expect(() => ampQuery('SELECT 1')).toThrow(/not configured/);
  });

  it('parses JSON Lines into typed rows over plain http', async () => {
    process.env.AMP_ENDPOINT = 'http://127.0.0.1:1603';
    process.env.AMP_TOKEN = 'sekret';
    httpRequest.mockImplementation(
      makeRequestImpl({ statusCode: 200, chunks: ['{"a":1}\n', '{"a":2}\n'] }),
    );
    const { ampQuery } = await import('@/lib/amp');
    const rows = await ampQuery<{ a: number }>('SELECT a');
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
    expect(httpRequest).toHaveBeenCalledTimes(1);
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('uses the https module when the endpoint is https', async () => {
    process.env.AMP_ENDPOINT = 'https://amp.example.com';
    process.env.AMP_TOKEN = 'sekret';
    httpsRequest.mockImplementation(
      makeRequestImpl({ statusCode: 200, chunks: ['{"ok":true}\n'] }),
    );
    const { ampQuery } = await import('@/lib/amp');
    const rows = await ampQuery('SELECT 1');
    expect(rows).toEqual([{ ok: true }]);
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });

  it('resolves to an empty array when the body is blank', async () => {
    process.env.AMP_ENDPOINT = 'http://127.0.0.1:1603';
    process.env.AMP_TOKEN = 'sekret';
    httpRequest.mockImplementation(
      makeRequestImpl({ statusCode: 200, chunks: ['   '] }),
    );
    const { ampQuery } = await import('@/lib/amp');
    await expect(ampQuery('SELECT 1')).resolves.toEqual([]);
  });

  it('rejects with AmpError carrying the status on a >=400 response', async () => {
    process.env.AMP_ENDPOINT = 'http://127.0.0.1:1603';
    process.env.AMP_TOKEN = 'sekret';
    httpRequest.mockImplementation(
      makeRequestImpl({ statusCode: 500, chunks: ['boom'] }),
    );
    const { ampQuery, AmpError } = await import('@/lib/amp');
    const err = await ampQuery('SELECT 1').catch((e) => e);
    expect(err).toBeInstanceOf(AmpError);
    expect(err.status).toBe(500);
    expect(err.message).toContain('500');
    expect(err.message).toContain('boom');
  });

  it('rejects when a JSON line is malformed', async () => {
    process.env.AMP_ENDPOINT = 'http://127.0.0.1:1603';
    process.env.AMP_TOKEN = 'sekret';
    httpRequest.mockImplementation(
      makeRequestImpl({ statusCode: 200, chunks: ['{not json}\n'] }),
    );
    const { ampQuery } = await import('@/lib/amp');
    await expect(ampQuery('SELECT 1')).rejects.toBeInstanceOf(SyntaxError);
  });

  it('propagates a low-level request error', async () => {
    process.env.AMP_ENDPOINT = 'http://127.0.0.1:1603';
    process.env.AMP_TOKEN = 'sekret';
    httpRequest.mockImplementation((_o: unknown, _cb: unknown) => {
      const req = new EventEmitter() as EventEmitter & {
        write: () => void;
        end: () => void;
        destroy: () => void;
      };
      req.write = vi.fn();
      req.destroy = vi.fn();
      req.end = vi.fn(() => {
        req.emit('error', new Error('ECONNREFUSED'));
      });
      return req;
    });
    const { ampQuery } = await import('@/lib/amp');
    await expect(ampQuery('SELECT 1')).rejects.toThrow(/ECONNREFUSED/);
  });
});
