/**
 * Amp client — queries the local ampd JSON Lines HTTP endpoint.
 *
 * Env vars (set in Vercel dashboard, never exposed to browser):
 *   AMP_ENDPOINT   e.g. http://207.154.215.37:1603
 *   AMP_TOKEN      shared secret sent as X-Amp-Token header
 */

import { keccak256, toHex } from 'viem';
import * as https from 'node:https';
import * as http from 'node:http';

const AMP_ENDPOINT = process.env.AMP_ENDPOINT?.trim();
const AMP_TOKEN = process.env.AMP_TOKEN?.trim();

// Force HTTP/1.1 ALPN — Tailscale Funnel drops TLS connections when undici negotiates h2.
const http1Agent = new https.Agent({ ALPNProtocols: ['http/1.1'] });
const http1AgentHttp = new http.Agent();

export function hasAmpAccess(): boolean {
  return Boolean(AMP_ENDPOINT && AMP_TOKEN);
}

export class AmpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AmpError';
  }
}

/**
 * Run a SQL query against ampd and return rows as typed objects.
 * ampd returns JSON Lines — one JSON object per line.
 * Uses node:https directly to force HTTP/1.1 ALPN (Tailscale Funnel h2 incompatibility).
 */
export function ampQuery<T = Record<string, unknown>>(
  sql: string,
  timeoutMs = 8000,
): Promise<T[]> {
  if (!AMP_ENDPOINT || !AMP_TOKEN) {
    throw new AmpError('AMP_ENDPOINT or AMP_TOKEN not configured');
  }

  const url = new URL(`${AMP_ENDPOINT}/`);
  const isHttps = url.protocol === 'https:';
  const body = Buffer.from(sql, 'utf8');

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy();
      const err = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      reject(err);
    }, timeoutMs);

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'X-Amp-Token': AMP_TOKEN!,
        'Content-Length': body.length,
      },
      agent: isHttps ? http1Agent : http1AgentHttp,
    };

    const req = (isHttps ? https : http).request(options, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        let errBody = '';
        res.on('data', (c: Buffer) => { errBody += c.toString(); });
        res.on('end', () => {
          clearTimeout(timer);
          reject(new AmpError(`ampd returned ${res.statusCode}: ${errBody}`, res.statusCode));
        });
        return;
      }

      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { text += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        if (!text.trim()) { resolve([]); return; }
        try {
          const rows = text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as T);
          resolve(rows);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.write(body);
    req.end();
  });
}

// ── Contract addresses ─────────────────────────────────────────────────────────

export const HORIZON_STAKING = '0x00669a4cf01450b64e8a2a20e9b1fcb71e61ef03';

// ── Event topic0 hashes ────────────────────────────────────────────────────────
// Computed via keccak256(toHex(eventSignature, { size: ... }))
// Each value is the canonical event selector used in raw logs.

function sig(s: string): string {
  return keccak256(toHex(s));
}

export const TOPIC0 = {
  // Delegation
  TokensDelegated: sig('TokensDelegated(address,address,address,uint256,uint256)'),
  TokensUndelegated: sig('TokensUndelegated(address,address,address,uint256,uint256)'),
  DelegatedTokensWithdrawn: sig('DelegatedTokensWithdrawn(address,address,address,uint256)'),
  DelegationSlashed: sig('DelegationSlashed(address,address,uint256)'),
  DelegationFeeCutSet: sig('DelegationFeeCutSet(address,address,uint8,uint256)'),

  // Staking
  HorizonStakeDeposited: sig('HorizonStakeDeposited(address,uint256)'),
  HorizonStakeLocked: sig('HorizonStakeLocked(address,uint256,uint256)'),
  HorizonStakeWithdrawn: sig('HorizonStakeWithdrawn(address,uint256)'),

  // Provisions
  ProvisionCreated: sig('ProvisionCreated(address,address,uint256,uint32,uint64)'),
  ProvisionIncreased: sig('ProvisionIncreased(address,address,uint256)'),
  ProvisionThawed: sig('ProvisionThawed(address,address,uint256)'),
  TokensDeprovisioned: sig('TokensDeprovisioned(address,address,uint256)'),
  ProvisionSlashed: sig('ProvisionSlashed(address,address,uint256)'),
} as const;

// ── SQL helpers ───────────────────────────────────────────────────────────────

/** The dataset ref to use in SQL FROM clauses. */
export const AMP_DATASET = '"_/arbitrum_one@1.0.0"';

/**
 * Strip 0x prefix for ampd SQL comparisons.
 * ampd stores address/topic as FixedSizeBinary — use X'hex' literals.
 */
export function strip0x(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

/**
 * Format a hex address/topic as an ampd SQL binary literal: X'deadbeef...'
 * Use this for WHERE address = hex('...') comparisons.
 */
export function hexLit(hex: string): string {
  return `X'${strip0x(hex)}'`;
}

/**
 * Extract a 20-byte address from a 32-byte padded topic hex string.
 * Raw log topics are 0x + 64 hex chars; the address is the last 40.
 */
export function topicToAddress(topic: string): string {
  const hex = topic.startsWith('0x') ? topic.slice(2) : topic;
  return '0x' + hex.slice(-40);
}

/**
 * Decode a uint256 from a raw 32-byte hex field (topic or data segment).
 */
export function hexToBigInt(hex: string): bigint {
  return BigInt(hex.startsWith('0x') ? hex : '0x' + hex);
}
