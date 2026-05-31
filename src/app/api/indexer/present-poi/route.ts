import { type NextRequest, NextResponse } from 'next/server';

const INDEXER_AGENT_URL = process.env.INDEXER_AGENT_URL;
// Optional Basic auth credentials for the management API proxy (format: "user:password")
const INDEXER_AGENT_TOKEN = process.env.INDEXER_AGENT_TOKEN;

function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    let h = u.hostname.toLowerCase();
    // strip IPv6 brackets / zone id
    h = h.replace(/^\[|\]$/g, '').split('%')[0];
    // localhost forms
    if (h === 'localhost' || h.endsWith('.localhost')) return false;
    // IPv4 private / loopback / link-local / unspecified / cloud-metadata
    if (/^127\./.test(h)) return false;
    if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    if (/^169\.254\./.test(h)) return false;          // link-local incl. 169.254.169.254 (cloud metadata)
    if (/^0\./.test(h) || h === '0.0.0.0') return false;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return false; // CGNAT 100.64/10
    // IPv6 loopback / link-local / unique-local
    if (h === '::1' || h === '::') return false;
    if (/^fe80:/.test(h) || /^f[cd][0-9a-f]{2}:/.test(h)) return false;   // link-local + ULA fc00::/7
    if (/^::ffff:/.test(h)) return false;             // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
    return true;
  } catch {
    return false;
  }
}

// POST — queue a presentPOI action on the indexer-agent management API.
// Body: { deploymentId: string, allocationId: string }
// Requires INDEXER_AGENT_URL env var pointing at the management API.
// Set INDEXER_AGENT_TOKEN="user:password" if the endpoint requires Basic auth.
// deploymentId is an IPFS CIDv0 (Qm…46 base58 chars); allocationId is a 0x… 40-hex address.
// These are interpolated into the GraphQL mutation below, so they MUST be validated to
// prevent GraphQL injection (breaking out of the string to inject extra actions).
const DEPLOYMENT_ID_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const ALLOCATION_ID_RE = /^0x[0-9a-fA-F]{40}$/;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { deploymentId, allocationId, agentUrl, agentToken } = body ?? {};

  if (!deploymentId || !allocationId) {
    return NextResponse.json(
      { error: 'deploymentId and allocationId are required' },
      { status: 400 },
    );
  }
  if (!DEPLOYMENT_ID_RE.test(deploymentId) || !ALLOCATION_ID_RE.test(allocationId)) {
    return NextResponse.json(
      { error: 'Invalid deploymentId (expect IPFS CIDv0 Qm…) or allocationId (expect 0x…40 hex)' },
      { status: 400 },
    );
  }

  const mutation = `mutation {
    queueActions(actions: [{
      type: presentPOI,
      deploymentID: "${deploymentId}",
      allocationID: "${allocationId}",
      protocolNetwork: "eip155:42161",
      status: approved,
      priority: 0,
      isLegacy: false,
      source: "lodestar-dashboard",
      reason: "bounty claim"
    }]) { id type status failureReason }
  }`;

  // Allow caller to override the agent URL (body takes precedence over env var)
  const targetUrl = agentUrl ?? INDEXER_AGENT_URL;
  if (!targetUrl) {
    return NextResponse.json(
      { error: 'INDEXER_AGENT_URL is not configured on this server and no agentUrl was provided' },
      { status: 503 }
    );
  }
  if (agentUrl && !isSafeUrl(agentUrl)) {
    return NextResponse.json(
      { error: 'Invalid agentUrl — must be a public http/https URL' },
      { status: 503 },
    );
  }

  const targetToken = agentToken ?? INDEXER_AGENT_TOKEN;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (targetToken) {
    headers['Authorization'] = `Basic ${Buffer.from(targetToken).toString('base64')}`;
  }

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: mutation }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to reach indexer-agent: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
