import { ImageResponse } from 'next/og';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';

export const runtime = 'edge';
export const alt = 'Subgraph Deployment | Lodestar';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

function formatGRT(amount: number): string {
  if (amount >= 1e9) return `${(amount / 1e9).toFixed(2)}B`;
  if (amount >= 1e6) return `${(amount / 1e6).toFixed(2)}M`;
  if (amount >= 1e3) return `${(amount / 1e3).toFixed(2)}K`;
  if (amount > 0 && amount < 1) return amount.toFixed(2);
  return amount.toFixed(0);
}

function weiToGRT(wei: string): number {
  const intPart = wei.split('.')[0];
  return Number(BigInt(intPart)) / 1e18;
}

function shortenHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function formatDate(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function relativeAge(unix: number): string {
  const days = Math.floor((Date.now() / 1000 - unix) / 86400);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

interface StatBoxProps {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}

/** Sized to its content. The grid is two rows rather than one, so the card is
 *  filled by numbers instead of by stretching three tiles over dead canvas. */
function StatBox({ label, value, sub, accent }: StatBoxProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        padding: '22px 26px',
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: '#9898A6',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 38,
          fontWeight: 700,
          color: accent ?? '#EEEEF2',
          marginTop: 8,
          letterSpacing: '-0.02em',
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: 14, color: '#6B6B7B', marginTop: 8 }}>{sub ?? ' '}</span>
    </div>
  );
}

function Chip({ text, tone }: { text: string; tone?: 'accent' | 'warn' }) {
  const colors =
    tone === 'warn'
      ? { fg: '#F87171', bg: 'rgba(248,113,113,0.10)', bd: 'rgba(248,113,113,0.28)' }
      : tone === 'accent'
        ? { fg: '#8B85FF', bg: 'rgba(139,133,255,0.10)', bd: 'rgba(139,133,255,0.24)' }
        : { fg: '#9898A6', bg: 'rgba(255,255,255,0.04)', bd: 'rgba(255,255,255,0.10)' };
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '7px 16px',
        borderRadius: 999,
        background: colors.bg,
        border: `1px solid ${colors.bd}`,
        fontSize: 15,
        color: colors.fg,
      }}
    >
      {text}
    </div>
  );
}

export default async function OGImage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = await params;

  let name = shortenHash(hash);
  let signal = 0;
  let activeIndexers = 0;
  let queryFees = 0;
  let allocated = 0;
  let curators = 0;
  let network: string | null = null;
  let createdAt = 0;
  let denied = false;
  let substreams = false;
  let found = false;

  try {
    if (hasSubgraphAccess()) {
      const data = await subgraphQuery<{
        subgraphDeployments: Array<{
          ipfsHash: string;
          createdAt: number;
          signalledTokens: string;
          stakedTokens: string;
          queryFeesAmount: string;
          deniedAt: number;
          manifest: { network: string | null; poweredBySubstreams: boolean } | null;
          indexerAllocations: { id: string }[];
          curatorSignals: { id: string }[];
          versions: { subgraph: { metadata: { displayName: string } | null } | null }[];
        }>;
      }>(`{
        subgraphDeployments(first: 1, where: { ipfsHash: "${hash}" }) {
          ipfsHash
          createdAt
          signalledTokens
          stakedTokens
          queryFeesAmount
          deniedAt
          manifest { network poweredBySubstreams }
          indexerAllocations(where: { status: Active }) { id }
          curatorSignals(first: 500) { id }
          versions(first: 1, orderBy: createdAt, orderDirection: desc) {
            subgraph { metadata { displayName } }
          }
        }
      }`);

      const dep = data.subgraphDeployments?.[0];
      if (dep) {
        found = true;
        name =
          dep.versions?.[0]?.subgraph?.metadata?.displayName ?? shortenHash(dep.ipfsHash);
        signal = weiToGRT(dep.signalledTokens);
        allocated = weiToGRT(dep.stakedTokens);
        queryFees = weiToGRT(dep.queryFeesAmount);
        activeIndexers = dep.indexerAllocations?.length ?? 0;
        curators = dep.curatorSignals?.length ?? 0;
        network = dep.manifest?.network ?? null;
        substreams = dep.manifest?.poweredBySubstreams ?? false;
        createdAt = dep.createdAt ?? 0;
        denied = (dep.deniedAt ?? 0) > 0;
      }
    }
  } catch {
    // fall through with defaults
  }

  const nameSize = name.length > 34 ? 34 : name.length > 26 ? 40 : 46;

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: '#111114',
          padding: '44px 56px 40px 56px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontSize: 13,
                color: '#6B6B7B',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}
            >
              Subgraph Deployment
            </span>
            <span
              style={{
                fontSize: nameSize,
                fontWeight: 700,
                color: '#EEEEF2',
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
                marginTop: 8,
              }}
            >
              {name.length > 42 ? name.slice(0, 42) + '…' : name}
            </span>
            <span
              style={{
                fontSize: 15,
                color: '#6B6B7B',
                fontFamily: 'monospace',
                marginTop: 8,
              }}
            >
              {shortenHash(hash)}
            </span>
          </div>

          {/* Lodestar badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 18px',
              borderRadius: 10,
              background: 'rgba(139,133,255,0.1)',
              border: '1px solid rgba(139,133,255,0.2)',
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: 'linear-gradient(135deg, #8B85FF 0%, #6C63FF 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                fontWeight: 800,
                color: '#fff',
              }}
            >
              L
            </div>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#8B85FF' }}>Lodestar</span>
          </div>
        </div>

        {/* Facts that are true even when a deployment has no signal or fees yet,
            which is every freshly published subgraph. */}
        <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
          {network && <Chip text={network} tone="accent" />}
          {substreams && <Chip text="Substreams" tone="accent" />}
          {denied && <Chip text="Rewards denied" tone="warn" />}
          {!found && <Chip text="Not found on the network" tone="warn" />}
        </div>

        {/* Two rows of three. Six real numbers fill the canvas; one row of three
            left ~280px of it empty, and stretching that row just moved the gap
            inside the tiles. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 22, flex: 1 }}>
          <div style={{ display: 'flex', gap: 14 }}>
            <StatBox
              label="Signal"
              value={`${formatGRT(signal)} GRT`}
              sub="Total curated"
            />
            <StatBox
              label="Active Indexers"
              value={String(activeIndexers)}
              sub={activeIndexers > 0 ? 'Allocating right now' : 'Nobody is indexing it'}
            />
            <StatBox
              label="Query Fees"
              value={`${formatGRT(queryFees)} GRT`}
              sub="All time"
            />
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <StatBox
              label="Curators"
              value={String(curators)}
              sub={curators > 0 ? 'Holding signal' : 'None yet'}
            />
            <StatBox
              label="Allocated Stake"
              value={`${formatGRT(allocated)} GRT`}
              sub="Across active allocations"
            />
            <StatBox
              label="Published"
              value={createdAt > 0 ? formatDate(createdAt) : '—'}
              sub={createdAt > 0 ? relativeAge(createdAt) : ''}
            />
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: '#8B85FF' }}>Lodestar</span>
            <span style={{ fontSize: 15, color: '#6B6B7B' }}>The Graph Protocol Analytics</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 4, background: '#34D399' }} />
            <span style={{ fontSize: 14, color: '#6B6B7B' }}>Arbitrum</span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
