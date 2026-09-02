/**
 * POST/DELETE /api/push/register-device.
 *
 * This binds an APNs device token to a wallet address, so every alert that wallet is entitled to
 * afterwards goes to whatever device is on the other end of that token. The gate is a signature,
 * and the tests below are mostly about the gate: nothing may be written before it passes, and the
 * address must be normalised the same way the notification dispatchers read it, or a registration
 * succeeds and then silently receives nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const dbTag = vi.fn();
const verifySubscribeSignature = vi.fn();
/** Flipped per-test so the "no database" branch is genuinely exercised. */
let dbAvailable = true;

vi.mock('@/lib/db', () => ({
  get db() {
    return dbAvailable ? dbTag : null;
  },
}));
vi.mock('@/lib/push-auth', () => ({
  ETH_ADDRESS_RE: /^0x[a-fA-F0-9]{40}$/,
  verifySubscribeSignature: (...a: unknown[]) => verifySubscribeSignature(...a),
}));

import { POST, DELETE } from '../register-device/route';

const ADDRESS = '0xAbCdEf1234567890abcdef1234567890AbCdEf12';
const TOKEN = 'a'.repeat(64);
const SIG = '0xsignature';

const req = (method: string, body: unknown) =>
  new NextRequest('http://localhost/api/push/register-device', {
    method,
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const post = (body: unknown) => POST(req('POST', body));
const del = (body: unknown) => DELETE(req('DELETE', body));

/** Values interpolated into the tagged-template queries, in call order. */
const queryValues = () => dbTag.mock.calls.map((c) => c.slice(1));

beforeEach(() => {
  vi.clearAllMocks();
  dbAvailable = true;
  dbTag.mockResolvedValue([]);
  verifySubscribeSignature.mockResolvedValue(true);
});

describe('POST /api/push/register-device', () => {
  it('400s on a body that is not JSON', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid JSON');
  });

  it.each([
    ['no address', { signature: SIG, token: TOKEN }],
    ['a malformed address', { address: '0xnope', signature: SIG, token: TOKEN }],
    ['no signature', { address: ADDRESS, token: TOKEN }],
    ['no token', { address: ADDRESS, signature: SIG }],
  ])('400s with %s, and writes nothing', async (_label, body) => {
    const res = await post(body);

    expect(res.status).toBe(400);
    expect(dbTag).not.toHaveBeenCalled();
    expect(verifySubscribeSignature).not.toHaveBeenCalled();
  });

  it('rejects an unknown platform', async () => {
    const res = await post({ address: ADDRESS, signature: SIG, token: TOKEN, platform: 'blackberry' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid platform');
  });

  it.each([
    ['too short', 'a'.repeat(31)],
    ['too long', 'a'.repeat(257)],
  ])('rejects a token that is %s', async (_label, token) => {
    const res = await post({ address: ADDRESS, signature: SIG, token });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid token');
  });

  it('REFUSES a bad signature with 403 and writes nothing', async () => {
    // The whole gate. Without it anyone could point another wallet's alerts at their own device.
    verifySubscribeSignature.mockResolvedValue(false);
    const res = await post({ address: ADDRESS, signature: SIG, token: TOKEN });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Signature mismatch');
    expect(dbTag).not.toHaveBeenCalled();
  });

  it('registers the device and opts the address in, on one signature', async () => {
    const res = await post({ address: ADDRESS, signature: SIG, token: TOKEN });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ registered: true });
    expect(dbTag).toHaveBeenCalledTimes(2); // subscription, then device token
  });

  it('LOWER-CASES the address, so the dispatchers can find it again', async () => {
    // Every notification dispatcher looks these up lower-cased. Storing the checksummed form
    // would register successfully and then deliver nothing, forever, silently.
    await post({ address: ADDRESS, signature: SIG, token: TOKEN });

    for (const values of queryValues()) {
      expect(values).not.toContain(ADDRESS);
      expect(values).toContain(ADDRESS.toLowerCase());
    }
  });

  it('defaults the platform to ios', async () => {
    await post({ address: ADDRESS, signature: SIG, token: TOKEN });
    expect(queryValues()[1]).toContain('ios');
  });

  it('accepts android', async () => {
    await post({ address: ADDRESS, signature: SIG, token: TOKEN, platform: 'android' });
    expect(queryValues()[1]).toContain('android');
  });

  it('503s when there is no database, before reading the body', async () => {
    dbAvailable = false;
    const res = await post({ address: ADDRESS, signature: SIG, token: TOKEN });

    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('Database not configured');
    expect(verifySubscribeSignature).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/push/register-device', () => {
  it('400s on a body that is not JSON', async () => {
    const res = await del('{not json');
    expect(res.status).toBe(400);
  });

  it('400s with no token', async () => {
    const res = await del({});

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Missing token');
    expect(dbTag).not.toHaveBeenCalled();
  });

  it('deactivates the token rather than deleting the row', async () => {
    // Keeping the row means a device that comes back is recognised rather than re-registered.
    const res = await del({ token: TOKEN });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ registered: false });
    expect(dbTag).toHaveBeenCalledTimes(1);
    expect(queryValues()[0]).toContain(TOKEN);
  });

  it('503s when there is no database', async () => {
    dbAvailable = false;
    const res = await del({ token: TOKEN });

    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('Database not configured');
  });

  it('does not require a signature to unbind', async () => {
    // Deliberate: logging out must work even when the wallet is no longer reachable. Knowing the
    // token is enough, and the only thing it grants is switching your own device off.
    await del({ token: TOKEN });
    expect(verifySubscribeSignature).not.toHaveBeenCalled();
  });
});
