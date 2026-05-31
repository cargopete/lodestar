/**
 * SSRF guards for outbound fetches to user/operator-supplied URLs.
 *
 * Two layers:
 *  1. isSafeUrlString — synchronous: scheme + literal private/loopback/metadata
 *     ranges (IPv4 + IPv6). Cheap, catches the obvious cases.
 *  2. isSafeUrlResolved — async: ALSO resolves the hostname via DNS and rejects
 *     if ANY resolved address is private. Closes the DNS-rebinding window where
 *     a hostname passes the string check but resolves to an internal IP.
 *
 * Node runtime only (uses node:dns). Routes using these must not be `edge`.
 */
import { lookup } from 'node:dns/promises';

/** Is this a private / loopback / link-local / unique-local / metadata IP literal? */
export function isPrivateIp(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  // IPv4
  if (/^127\./.test(h)) return true;                                   // loopback
  if (/^10\./.test(h)) return true;                                    // private
  if (/^192\.168\./.test(h)) return true;                              // private
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;               // private 172.16/12
  if (/^169\.254\./.test(h)) return true;                              // link-local + 169.254.169.254 metadata
  if (/^0\./.test(h) || h === '0.0.0.0') return true;                  // "this" / unspecified
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true; // CGNAT 100.64/10
  // IPv6
  if (h === '::1' || h === '::') return true;                          // loopback / unspecified
  if (/^fe80:/.test(h)) return true;                                   // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;                       // unique-local fc00::/7
  if (/^::ffff:/.test(h)) return true;                                 // IPv4-mapped
  return false;
}

/** Synchronous string-level check: scheme + host literal not private/localhost. */
export function isSafeUrlString(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
    if (h === 'localhost' || h.endsWith('.localhost')) return false;
    if (isPrivateIp(h)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Full check: string-level guard PLUS DNS resolution — rejects if the hostname
 * resolves to any private address (defeats DNS rebinding). Returns false on any
 * resolution failure (fail closed).
 */
export async function isSafeUrlResolved(raw: string): Promise<boolean> {
  if (!isSafeUrlString(raw)) return false;
  try {
    const { hostname } = new URL(raw);
    // If the host is already an IP literal, isSafeUrlString covered it.
    const results = await lookup(hostname, { all: true });
    if (results.length === 0) return false;
    return results.every((r) => !isPrivateIp(r.address));
  } catch {
    return false; // fail closed on DNS error
  }
}
