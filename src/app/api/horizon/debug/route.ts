/**
 * GET /api/horizon/debug
 *
 * Diagnostic endpoint: TCP connect probe + raw ampd query.
 * Reports exactly where the connection fails (TCP / TLS / HTTP).
 */

import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 120;
import * as net from 'node:net';
import * as tls from 'node:tls';
import * as dns from 'node:dns/promises';
import {
  ampQuery,
  hasAmpAccess,
  AmpError,
  HORIZON_STAKING,
  AMP_DATASET,
  hexLit,
} from '@/lib/amp';

const AMP_ENDPOINT = process.env.AMP_ENDPOINT?.trim() ?? '';
const AMP_TOKEN = process.env.AMP_TOKEN?.trim() ?? '';

function tcpProbe(host: string, port: number, timeoutMs = 5000): Promise<{ ok: boolean; ms: number; error?: string }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = new net.Socket();
    const done = (ok: boolean, error?: string) => {
      sock.destroy();
      resolve({ ok, ms: Date.now() - t0, error });
    };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => done(true));
    sock.on('timeout', () => done(false, 'TCP connect timed out'));
    sock.on('error', (e) => done(false, e.message));
    sock.connect(port, host);
  });
}

function tlsProbe(host: string, port: number, timeoutMs = 5000): Promise<{ ok: boolean; ms: number; protocol?: string; alpn?: string; error?: string }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = tls.connect({ host, port, servername: host, ALPNProtocols: ['http/1.1'], rejectUnauthorized: true });
    const timer = setTimeout(() => { sock.destroy(); resolve({ ok: false, ms: Date.now() - t0, error: 'TLS handshake timed out' }); }, timeoutMs);
    sock.on('secureConnect', () => {
      clearTimeout(timer);
      const alpn = sock.alpnProtocol || 'none';
      const proto = sock.getProtocol() || 'unknown';
      sock.destroy();
      resolve({ ok: true, ms: Date.now() - t0, protocol: proto, alpn });
    });
    sock.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, ms: Date.now() - t0, error: e.message }); });
  });
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = AMP_ENDPOINT ? new URL(`${AMP_ENDPOINT}/`) : null;
  const host = url?.hostname ?? '(not set)';
  const port = url ? (parseInt(url.port || '443', 10)) : 443;

  // 1. DNS
  let dnsResult: string[] | string = '(skipped)';
  if (url) {
    try { dnsResult = await dns.resolve4(host); }
    catch (e) { dnsResult = `DNS error: ${String(e)}`; }
  }

  // 2. TCP
  const tcp = url ? await tcpProbe(host, port) : { ok: false, ms: 0, error: 'no endpoint' };

  // 3. TLS
  const tlsR = (url && tcp.ok) ? await tlsProbe(host, port) : { ok: false, ms: 0, error: tcp.ok ? 'skipped' : 'TCP failed' };

  // 4. SELECT 1 — confirms HTTP round-trip works end-to-end
  let pingResult: unknown = 'skipped';
  if (!hasAmpAccess()) {
    pingResult = 'AMP_ENDPOINT or AMP_TOKEN not set';
  } else if (tlsR.ok) {
    const t0 = Date.now();
    try {
      const rows = await ampQuery<Record<string, unknown>>('SELECT 1', 10_000);
      pingResult = { ok: true, ms: Date.now() - t0, rows };
    } catch (e) {
      pingResult = { ok: false, ms: Date.now() - t0, error: String(e) };
    }
  }

  // 5. Real query — only if ping succeeded
  let queryResult: unknown = 'skipped';
  if (hasAmpAccess() && tlsR.ok && (pingResult as { ok?: boolean }).ok) {
    const t0 = Date.now();
    try {
      const rows = await ampQuery<{ block_num: number; tx_hash: string; log_index: number; topic0: string; topic1: string }>(`
        SELECT block_num, tx_hash, log_index, topic0, topic1
        FROM ${AMP_DATASET}.logs
        WHERE address = ${hexLit(HORIZON_STAKING)}
        ORDER BY block_num DESC
        LIMIT 5
      `, 90_000);
      queryResult = { ok: true, ms: Date.now() - t0, rowCount: rows.length, rows };
    } catch (e) {
      queryResult = { ok: false, ms: Date.now() - t0, error: String(e) };
    }
  }

  return NextResponse.json({
    env: {
      AMP_ENDPOINT: AMP_ENDPOINT || '(not set)',
      AMP_TOKEN: AMP_TOKEN ? `${AMP_TOKEN.slice(0, 8)}…` : '(not set)',
    },
    dns: dnsResult,
    tcp,
    tls: tlsR,
    ping: pingResult,
    query: queryResult,
  });
}
