import { createHmac } from 'crypto';

/**
 * Client IP handling for Scuttlebutt.
 *
 * We never store the raw IP. For moderation (rate-limit keys, bans) we keep only
 * an HMAC of it under a server pepper — stable enough to ban a repeat offender,
 * useless as PII if the table ever leaks.
 */

/** Extract the caller's IP the same way middleware.ts does. */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

/** HMAC-hash an IP under SCUTTLEBUTT_IP_PEPPER. Returns a 32-char hex digest. */
export function hashIp(ip: string): string {
  const pepper = process.env.SCUTTLEBUTT_IP_PEPPER ?? '';
  return createHmac('sha256', pepper).update(ip).digest('hex').slice(0, 32);
}
