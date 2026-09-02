/**
 * APNs sending.
 *
 * This module is the last mile of every alert the dashboard raises, and it had no tests at all.
 * The failures worth pinning are the quiet ones: a misconfigured key silently sending nothing is
 * correct behaviour, a malformed JWT is not, and a dead device token that never gets pruned means
 * every future send to that wallet does useless work for ever.
 *
 * The ES256 signature is verified with `crypto.verify` rather than eyeballed for shape. JWS wants
 * the raw r||s pair, and a DER signature is the same bytes in a different wrapper: it looks
 * plausible, base64urls fine, and Apple rejects every push.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

/** A real P-256 key, so the signature can actually be checked. */
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

interface FakeResponse {
  status: number;
  body?: string;
  streamError?: boolean;
}

/** Per-device-token responses, keyed by the token in the `:path` pseudo-header. */
let programmed: Record<string, FakeResponse> = {};
let connectError = false;
let sentHeaders: Record<string, string>[] = [];
let sentPayloads: string[] = [];
let closed = 0;
let connectedTo: string[] = [];

function makeRequest(headers: Record<string, string>) {
  sentHeaders.push(headers);
  const token = headers[':path'].replace('/3/device/', '');
  const handlers: Record<string, ((arg?: unknown) => void)[]> = {};
  const on = (event: string, cb: (arg?: unknown) => void) => {
    (handlers[event] ??= []).push(cb);
    return req;
  };
  const emit = (event: string, arg?: unknown) => (handlers[event] ?? []).forEach((h) => h(arg));

  const req = {
    setEncoding: () => req,
    on,
    end: (payload: string) => {
      sentPayloads.push(payload);
      // Asynchronous, as a real stream is; the sender's promise must survive it.
      setTimeout(() => {
        const r = programmed[token] ?? { status: 200 };
        if (r.streamError) {
          emit('error', new Error('stream blew up'));
          return;
        }
        emit('response', { ':status': String(r.status) });
        if (r.body) emit('data', r.body);
        emit('end');
      }, 0);
    },
  };
  return req;
}

vi.mock('node:http2', () => ({
  default: {
    connect: (host: string) => {
      connectedTo.push(host);
      const handlers: Record<string, ((arg?: unknown) => void)[]> = {};
      const client = {
        on: (event: string, cb: (arg?: unknown) => void) => {
          (handlers[event] ??= []).push(cb);
          if (event === 'error' && connectError) setTimeout(() => cb(new Error('no route')), 0);
          return client;
        },
        request: makeRequest,
        close: () => {
          closed += 1;
        },
      };
      return client;
    },
  },
}));

const dbTag = vi.fn();
vi.mock('@/lib/db', () => ({
  get db() {
    return dbTag;
  },
}));

/** Queue result sets for the tagged-template db in call order, and record the calls. */
function queueDb(...results: unknown[][]) {
  let i = 0;
  dbTag.mockReset();
  dbTag.mockImplementation(() => Promise.resolve(results[i++] ?? []));
}

function configure(overrides: Record<string, string | undefined> = {}) {
  process.env.APNS_AUTH_KEY_BASE64 = Buffer.from(PEM).toString('base64');
  process.env.APNS_KEY_ID = '7SYS8ZZPW8';
  process.env.APNS_TEAM_ID = 'TRG36N45GH';
  process.env.APNS_TOPIC = 'com.lodestar.dashboard';
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const KEYS = [
  'APNS_AUTH_KEY_BASE64',
  'APNS_AUTH_KEY',
  'APNS_KEY_ID',
  'APNS_TEAM_ID',
  'APNS_TOPIC',
  'APNS_PRODUCTION',
];

beforeEach(() => {
  vi.resetModules(); // the JWT is cached at module scope
  programmed = {};
  connectError = false;
  sentHeaders = [];
  sentPayloads = [];
  closed = 0;
  connectedTo = [];
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

const load = () => import('../apns');

describe('apnsConfigured', () => {
  it('is false with nothing set', async () => {
    expect((await load()).apnsConfigured()).toBe(false);
  });

  it('is true once key, key id, team and topic are all present', async () => {
    configure();
    expect((await load()).apnsConfigured()).toBe(true);
  });

  it.each(['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_TOPIC'])(
    'is false when %s alone is missing',
    async (missing) => {
      configure({ [missing]: undefined });
      expect((await load()).apnsConfigured()).toBe(false);
    },
  );

  it('accepts a raw key with escaped newlines instead of base64', async () => {
    configure({ APNS_AUTH_KEY_BASE64: undefined, APNS_AUTH_KEY: PEM.replace(/\n/g, '\\n') });
    expect((await load()).apnsConfigured()).toBe(true);
  });
});

describe('sendApns', () => {
  it('sends nothing, and opens no connection, when unconfigured', async () => {
    const { sendApns } = await load();
    expect(await sendApns(['tok'], { title: 't', body: 'b' })).toEqual([]);
    expect(sentHeaders).toHaveLength(0);
  });

  it('sends nothing when there are no tokens', async () => {
    configure();
    const { sendApns } = await load();
    expect(await sendApns([], { title: 't', body: 'b' })).toEqual([]);
    expect(sentHeaders).toHaveLength(0);
  });

  it('mints an ES256 JWT that actually verifies against the key', async () => {
    configure();
    const { sendApns } = await load();
    await sendApns(['tok'], { title: 't', body: 'b' });

    const auth = sentHeaders[0].authorization;
    expect(auth.startsWith('bearer ')).toBe(true);
    const [h, p, s] = auth.slice(7).split('.');

    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    expect(header).toEqual({ alg: 'ES256', kid: '7SYS8ZZPW8' });

    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(payload.iss).toBe('TRG36N45GH');
    expect(payload.iat).toBeCloseTo(Math.floor(Date.now() / 1000), -1);

    // Raw r||s, 64 bytes for P-256. A DER signature would be a different length and would fail
    // verification even though it base64urls perfectly well.
    const sig = Buffer.from(s, 'base64url');
    expect(sig).toHaveLength(64);
    expect(
      crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig),
    ).toBe(true);
  });

  it('reuses one bearer token across sends rather than minting per push', async () => {
    // APNs rate-limits token regeneration, so this is a correctness rule, not an optimisation.
    configure();
    const { sendApns } = await load();
    await sendApns(['a'], { title: 't', body: 'b' });
    await sendApns(['b'], { title: 't', body: 'b' });
    expect(sentHeaders[0].authorization).toBe(sentHeaders[1].authorization);
  });

  it('sets the alert payload, topic and priority headers', async () => {
    configure();
    const { sendApns } = await load();
    await sendApns(['tok'], { title: 'Title', body: 'Body', path: '/indexers/0xabc' });

    expect(sentHeaders[0]).toMatchObject({
      ':method': 'POST',
      ':path': '/3/device/tok',
      'apns-topic': 'com.lodestar.dashboard',
      'apns-push-type': 'alert',
      'apns-priority': '10',
    });
    expect(JSON.parse(sentPayloads[0])).toEqual({
      aps: { alert: { title: 'Title', body: 'Body' }, sound: 'default' },
      path: '/indexers/0xabc',
    });
  });

  it('omits path from the payload when none is given', async () => {
    configure();
    const { sendApns } = await load();
    await sendApns(['tok'], { title: 'T', body: 'B' });
    expect(JSON.parse(sentPayloads[0])).not.toHaveProperty('path');
  });

  it('sets a collapse id only when asked', async () => {
    configure();
    const { sendApns } = await load();
    await sendApns(['tok'], { title: 'T', body: 'B' });
    expect(sentHeaders[0]).not.toHaveProperty('apns-collapse-id');

    await sendApns(['tok'], { title: 'T', body: 'B', collapseId: 'dips-live' });
    expect(sentHeaders[1]['apns-collapse-id']).toBe('dips-live');
  });

  it('reports each token separately and closes the session', async () => {
    configure();
    programmed = {
      good: { status: 200 },
      gone: { status: 410, body: JSON.stringify({ reason: 'Unregistered' }) },
    };
    const { sendApns } = await load();
    const results = await sendApns(['good', 'gone'], { title: 'T', body: 'B' });

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.token === 'good')).toMatchObject({ ok: true, status: 200 });
    expect(results.find((r) => r.token === 'gone')).toMatchObject({
      ok: false,
      status: 410,
      reason: 'Unregistered',
    });
    expect(closed).toBe(1);
  });

  it('falls back to raw text when an error body is not JSON', async () => {
    configure();
    programmed = { tok: { status: 500, body: 'upstream exploded' } };
    const { sendApns } = await load();
    const [r] = await sendApns(['tok'], { title: 'T', body: 'B' });
    expect(r.reason).toBe('upstream exploded');
  });

  it('records a stream failure as a result rather than throwing', async () => {
    // Never throws is the contract: one bad stream must not lose the other tokens' outcomes.
    configure();
    programmed = { bad: { status: 0, streamError: true }, good: { status: 200 } };
    const { sendApns } = await load();
    const results = await sendApns(['bad', 'good'], { title: 'T', body: 'B' });

    expect(results.find((r) => r.token === 'bad')).toMatchObject({
      ok: false,
      status: 0,
      reason: 'stream-error',
    });
    expect(results.find((r) => r.token === 'good')?.ok).toBe(true);
  });

  it('resolves rather than hanging when the connection itself fails', async () => {
    configure();
    connectError = true;
    programmed = { tok: { status: 200 } };
    const { sendApns } = await load();
    await expect(sendApns(['tok'], { title: 'T', body: 'B' })).resolves.toBeDefined();
  });

  it.each([
    [undefined, 'https://api.push.apple.com'],
    ['true', 'https://api.push.apple.com'],
    ['anything-else', 'https://api.push.apple.com'],
    ['false', 'https://api.sandbox.push.apple.com'],
    ['0', 'https://api.sandbox.push.apple.com'],
  ])('APNS_PRODUCTION=%s connects to %s', async (value, host) => {
    // Production is the default, and only the two explicit opt-outs reach sandbox. Getting this
    // backwards sends every real alert to a server the App Store build is not registered with,
    // and APNs answers politely rather than erroring.
    configure({ APNS_PRODUCTION: value });
    const { sendApns } = await load();
    await sendApns(['tok'], { title: 'T', body: 'B' });
    expect(connectedTo).toEqual([host]);
  });
});

describe('sendToAddress', () => {
  it('returns 0 when APNs is unconfigured', async () => {
    queueDb();
    const { sendToAddress } = await load();
    expect(await sendToAddress('0xABC', { title: 'T', body: 'B' })).toBe(0);
    expect(dbTag).not.toHaveBeenCalled();
  });

  it('returns 0 when the wallet has no active device', async () => {
    configure();
    queueDb([]);
    const { sendToAddress } = await load();
    expect(await sendToAddress('0xABC', { title: 'T', body: 'B' })).toBe(0);
    expect(sentHeaders).toHaveLength(0);
  });

  it('lower-cases the address before looking devices up', async () => {
    // Addresses arrive checksummed from chain data and lower-cased from the database. Skipping
    // this would silently deliver nothing to anyone whose address arrived in mixed case.
    configure();
    queueDb([{ token: 'tok' }]);
    const { sendToAddress } = await load();
    await sendToAddress('0xAbCdEf', { title: 'T', body: 'B' });
    expect(dbTag.mock.calls[0].slice(1)).toContain('0xabcdef');
  });

  it('counts only the deliveries APNs accepted', async () => {
    configure();
    programmed = { ok1: { status: 200 }, bad: { status: 400 }, ok2: { status: 200 } };
    queueDb([{ token: 'ok1' }, { token: 'bad' }, { token: 'ok2' }]);
    const { sendToAddress } = await load();
    expect(await sendToAddress('0xabc', { title: 'T', body: 'B' })).toBe(2);
  });

  it('deactivates tokens APNs says are permanently gone', async () => {
    configure();
    programmed = {
      gone410: { status: 410, body: '{}' },
      badtok: { status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) },
      unreg: { status: 400, body: JSON.stringify({ reason: 'Unregistered' }) },
      alive: { status: 200 },
    };
    queueDb([{ token: 'gone410' }, { token: 'badtok' }, { token: 'unreg' }, { token: 'alive' }]);
    const { sendToAddress } = await load();
    const delivered = await sendToAddress('0xabc', { title: 'T', body: 'B' });

    expect(delivered).toBe(1);
    const prune = dbTag.mock.calls[1];
    expect(prune).toBeDefined();
    const dead = prune.slice(1).flat() as string[][];
    expect(dead.flat().sort()).toEqual(['badtok', 'gone410', 'unreg']);
  });

  it('does not run a prune query when every token is healthy', async () => {
    configure();
    queueDb([{ token: 'a' }, { token: 'b' }]);
    const { sendToAddress } = await load();
    await sendToAddress('0xabc', { title: 'T', body: 'B' });
    expect(dbTag).toHaveBeenCalledTimes(1);
  });

  it('keeps a merely failed token active, since a 500 is not a dead device', async () => {
    configure();
    programmed = { flaky: { status: 500, body: 'try again' } };
    queueDb([{ token: 'flaky' }]);
    const { sendToAddress } = await load();
    expect(await sendToAddress('0xabc', { title: 'T', body: 'B' })).toBe(0);
    expect(dbTag).toHaveBeenCalledTimes(1);
  });
});
