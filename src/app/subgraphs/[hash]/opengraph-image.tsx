import { ImageResponse } from 'next/og';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';

export const runtime = 'edge';
export const alt = 'Subgraph Deployment — Lodestar';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

function formatGRT(amount: number): string {
  if (amount >= 1e9) return `${(amount / 1e9).toFixed(2)}B`;
  if (amount >= 1e6) return `${(amount / 1e6).toFixed(2)}M`;
  if (amount >= 1e3) return `${(amount / 1e3).toFixed(2)}K`;
  return amount.toFixed(0);
}

function weiToGRT(wei: string): number {
  const intPart = wei.split('.')[0];
  return Number(BigInt(intPart)) / 1e18;
}

function shortenHash(hash: string): string {
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

interface StatBoxProps {
  label: string;
  value: string;
  sub?: string;
}

function StatBox({ label, value, sub }: StatBoxProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        padding: '20px 24px',
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 12,
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
      <span style={{ fontSize: 28, fontWeight: 700, color: '#EEEEF2', marginTop: 6 }}>
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: 13, color: '#6B6B7B', marginTop: 4 }}>{sub}</span>
      )}
    </div>
  );
}

export default async function OGImage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = await params;

  let name = 'Unknown Subgraph';
  let signal = 0;
  let activeIndexers = 0;
  let queryFees = 0;

  try {
    if (hasSubgraphAccess()) {
      const data = await subgraphQuery<{
        subgraphDeployments: Array<{
          id: string;
          ipfsHash: string;
          signalledTokens: string;
          stakedTokens: string;
          queryFeesAmount: string;
          indexerAllocations: { id: string }[];
          versions: { subgraph: { metadata: { displayName: string } | null } | null }[];
        }>;
      }>(`{
        subgraphDeployments(first: 1, where: { ipfsHash: "${hash}" }) {
          id
          ipfsHash
          signalledTokens
          stakedTokens
          queryFeesAmount
          indexerAllocations(where: { status: Active }) { id }
          versions(first: 1, orderBy: createdAt, orderDirection: desc) {
            subgraph { metadata { displayName } }
          }
        }
      }`);

      const dep = data.subgraphDeployments?.[0];
      if (dep) {
        name =
          dep.versions?.[0]?.subgraph?.metadata?.displayName ??
          shortenHash(dep.ipfsHash);
        signal = weiToGRT(dep.signalledTokens);
        activeIndexers = dep.indexerAllocations?.length ?? 0;
        queryFees = weiToGRT(dep.queryFeesAmount);
      }
    }
  } catch {
    // fall through with defaults
  }

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: '#111114',
          padding: '48px 56px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, color: '#6B6B7B', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Subgraph Deployment
            </span>
            <span
              style={{
                fontSize: name.length > 30 ? 34 : 42,
                fontWeight: 700,
                color: '#EEEEF2',
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
              }}
            >
              {name.length > 40 ? name.slice(0, 40) + '…' : name}
            </span>
            <span style={{ fontSize: 14, color: '#6B6B7B', fontFamily: 'monospace', marginTop: 4 }}>
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

        {/* Stats grid */}
        <div style={{ display: 'flex', gap: 16, marginTop: 44 }}>
          <StatBox label="Signal" value={`${formatGRT(signal)} GRT`} />
          <StatBox label="Active Indexers" value={String(activeIndexers)} />
          <StatBox label="Total Query Fees" value={`${formatGRT(queryFees)} GRT`} />
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 'auto',
            paddingTop: 32,
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
