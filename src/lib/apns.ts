/**
 * Server-side APNs (Apple Push Notification service) sender for the native iOS
 * app. Token-based auth (ES256 JWT over a team .p8 key), HTTP/2 — APNs only
 * speaks HTTP/2, which Node's fetch/undici can't do, so we use node:http2.
 *
 * Env:
 *   APNS_AUTH_KEY_BASE64 — base64 of the AuthKey_XXXX.p8 (PKCS#8 EC private key)
 *   APNS_KEY_ID          — the key's 10-char id (e.g. 7SYS8ZZPW8)
 *   APNS_TEAM_ID         — Apple team id (TRG36N45GH)
 *   APNS_TOPIC           — bundle id (com.lodestar.dashboard)
 *   APNS_PRODUCTION      — 'true' (default) for TestFlight/App Store, else sandbox
 *
 * If the key vars are absent the sender is a no-op (returns 0 sent), so the app
 * runs fine without push configured.
 */
import http2 from 'node:http2';
import crypto from 'node:crypto';

import { db } from '@/lib/db';

export interface ApnsNotification {
  title: string;
  body: string;
  /** In-app path to open on tap, e.g. "/indexers/0xabc". Read natively. */
  path?: string;
  /** Optional collapse id so repeated alerts replace rather than stack. */
  collapseId?: string;
}

interface ApnsResult {
  token: string;
  ok: boolean;
  status: number;
  reason?: string;
}

function privateKeyPem(): string | null {
  const b64 = process.env.APNS_AUTH_KEY_BASE64;
  if (b64) return Buffer.from(b64, 'base64').toString('utf8');
  const raw = process.env.APNS_AUTH_KEY;
  if (raw) return raw.replace(/\\n/g, '\n');
  return null;
}

export function apnsConfigured(): boolean {
  return Boolean(
    privateKeyPem() &&
      process.env.APNS_KEY_ID &&
      process.env.APNS_TEAM_ID &&
      process.env.APNS_TOPIC,
  );
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// APNs caps how often the bearer token may be regenerated; reuse for ~50 min.
let cachedJwt: { token: string; mintedAt: number } | null = null;

function mintJwt(): string {
  if (cachedJwt && Date.now() - cachedJwt.mintedAt < 50 * 60 * 1000) {
    return cachedJwt.token;
  }
  const pem = privateKeyPem();
  if (!pem) throw new Error('APNS auth key not configured');
  const header = { alg: 'ES256', kid: process.env.APNS_KEY_ID };
  const payload = { iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  // JWS ES256 wants the raw r||s signature (ieee-p1363), not DER.
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: pem,
    dsaEncoding: 'ieee-p1363',
  });
  const token = `${signingInput}.${base64url(signature)}`;
  cachedJwt = { token, mintedAt: Date.now() };
  return token;
}

function apnsHost(): string {
  const production = process.env.APNS_PRODUCTION !== 'false' && process.env.APNS_PRODUCTION !== '0';
  return production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
}

/**
 * Sends one notification to many device tokens over a single HTTP/2 session.
 * Never throws — returns a per-token result so callers can prune dead tokens.
 */
export async function sendApns(
  tokens: string[],
  notification: ApnsNotification,
): Promise<ApnsResult[]> {
  if (tokens.length === 0 || !apnsConfigured()) return [];

  let jwt: string;
  try {
    jwt = mintJwt();
  } catch {
    return [];
  }

  const topic = process.env.APNS_TOPIC!;
  const payload = JSON.stringify({
    aps: {
      alert: { title: notification.title, body: notification.body },
      sound: 'default',
    },
    ...(notification.path ? { path: notification.path } : {}),
  });

  const client = http2.connect(apnsHost());
  const results: ApnsResult[] = [];

  await new Promise<void>((resolve) => {
    let pending = tokens.length;
    let settled = false;
    const done = () => {
      if (settled) return;
      if (--pending <= 0) {
        settled = true;
        resolve();
      }
    };
    client.on('error', () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });

    for (const token of tokens) {
      const headers: Record<string, string> = {
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${jwt}`,
        'apns-topic': topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
      };
      if (notification.collapseId) headers['apns-collapse-id'] = notification.collapseId;

      const req = client.request(headers);
      let status = 0;
      let data = '';
      req.setEncoding('utf8');
      req.on('response', (h) => {
        status = Number(h[':status']) || 0;
      });
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        let reason: string | undefined;
        if (status !== 200 && data) {
          try {
            reason = JSON.parse(data).reason;
          } catch {
            reason = data.slice(0, 120);
          }
        }
        results.push({ token, ok: status === 200, status, reason });
        done();
      });
      req.on('error', () => {
        results.push({ token, ok: false, status: 0, reason: 'stream-error' });
        done();
      });
      req.end(payload);
    }
  });

  client.close();
  return results;
}

/**
 * Sends to every active device of a wallet address, then prunes tokens APNs
 * reports as permanently gone (410 BadDeviceToken / Unregistered). Returns the
 * number delivered.
 */
export async function sendToAddress(
  address: string,
  notification: ApnsNotification,
): Promise<number> {
  if (!db || !apnsConfigured()) return 0;
  const normalised = address.toLowerCase();
  const rows = await db<{ token: string }[]>`
    SELECT token FROM device_tokens WHERE address = ${normalised} AND is_active
  `;
  if (rows.length === 0) return 0;

  const results = await sendApns(
    rows.map((r) => r.token),
    notification,
  );

  const dead = results
    .filter((r) => r.status === 410 || r.reason === 'BadDeviceToken' || r.reason === 'Unregistered')
    .map((r) => r.token);
  if (dead.length > 0) {
    await db`UPDATE device_tokens SET is_active = FALSE WHERE token = ANY(${dead})`;
  }

  return results.filter((r) => r.ok).length;
}
