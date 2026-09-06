import { ImageResponse } from 'next/og';
import { cacheGet } from '@/lib/cache';
import { hasNuthatch, nuthatchSqlReady } from '@/lib/nuthatch';
import { indexerDetailSql, type NestIndexerDetailRow } from '@/lib/nest-queries';
import type { EnrichedIndexer } from '@/lib/enriched';

export const runtime = 'edge';
export const alt = 'Indexer Profile | Lodestar';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

function formatGRT(amount: number): string {
  if (amount >= 1e9) return `${(amount / 1e9).toFixed(2)}B`;
  if (amount >= 1e6) return `${(amount / 1e6).toFixed(2)}M`;
  if (amount >= 1e3) return `${(amount / 1e3).toFixed(2)}K`;
  return amount.toFixed(2);
}

function weiToGRT(wei: string): number {
  const intPart = wei.split('.')[0];
  return Number(BigInt(intPart)) / 1e18;
}

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

interface StatBoxProps {
  label: string;
  value: string;
  sub?: string;
}

function StatBox({ label, value, sub }: StatBoxProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      padding: '20px 24px',
      background: 'rgba(255,255,255,0.04)',
      borderRadius: 12,
      border: '1px solid rgba(255,255,255,0.08)',
    }}>
      <span style={{ fontSize: 13, color: '#9898A6', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </span>
      <span style={{ fontSize: 28, fontWeight: 700, color: '#EEEEF2', marginTop: 6 }}>
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: 13, color: '#6B6B7B', marginTop: 4 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

export default async function OGImage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const addr = address.toLowerCase();

  // Try enriched cache first (has pre-computed data)
  let name = shortenAddress(addr);
  let selfStake = 0;
  let delegated = 0;
  let allocations = 0;
  let totalRewards = 0;
  let reoStatus: string = 'unknown';
  let scoreGrade: string = '—';
  let apr: string | null = null;

  try {
    const enrichedList = await cacheGet<EnrichedIndexer[]>('lodestar:indexers-enriched');
    const enriched = enrichedList?.find(e => e.id === addr);

    if (enriched) {
      name = enriched.name;
      selfStake = enriched.selfStakeGRT;
      delegated = enriched.delegatedGRT;
      allocations = enriched.allocationCount;
      totalRewards = weiToGRT(enriched.rewardsEarned);
      reoStatus = enriched.reoStatus;
      scoreGrade = enriched.scoreGrade;
      if (enriched.delegatorAPR > 0) apr = `${enriched.delegatorAPR.toFixed(1)}%`;
    } else if (hasNuthatch()) {
      // Fallback from the nest (nuthatch#1160): the figures are the indexer's; the name is the address,
      // since ENS and IPFS names are group B work. The gateway path this once fell back to left with the key.
      const r = await nuthatchSqlReady<NestIndexerDetailRow>(indexerDetailSql(addr), process.env.NUTHATCH_INDEXERS_BASE_PATH || '/alloc');
      const ix = r.ok ? r.data.rows[0] : undefined;
      if (ix) {
        name = shortenAddress(addr);
        selfStake = weiToGRT(ix.staked_tokens);
        delegated = weiToGRT(ix.delegated_tokens);
        allocations = Number(ix.allocation_count);
        totalRewards = weiToGRT(ix.rewards_earned);
      }
    }
  } catch (e) {
    console.warn('OG image data fetch failed:', e);
  }

  const reoColor = reoStatus === 'eligible' ? '#34D399' : reoStatus === 'ineligible' ? '#F87171' : '#6B6B7B';
  const reoLabel = reoStatus === 'eligible' ? 'Eligible' : reoStatus === 'ineligible' ? 'Ineligible' : 'Unknown';
  const gradeColor = scoreGrade === 'A' ? '#34D399' : scoreGrade === 'B' ? '#8B85FF' : scoreGrade === 'C' ? '#FBBF24' : '#F87171';

  return new ImageResponse(
    (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: '#111114',
        padding: '48px 56px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Avatar circle */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 56,
                height: 56,
                borderRadius: 28,
                background: 'linear-gradient(135deg, #8B85FF 0%, #6C63FF 100%)',
                fontSize: 22,
                fontWeight: 700,
                color: '#EEEEF2',
              }}>
                {name.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 32, fontWeight: 700, color: '#EEEEF2' }}>
                  {name.length > 28 ? name.slice(0, 28) + '...' : name}
                </span>
                <span style={{ fontSize: 15, color: '#6B6B7B', fontFamily: 'monospace' }}>
                  {shortenAddress(addr)}
                </span>
              </div>
            </div>
          </div>
          {/* Badges */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {scoreGrade !== '—' && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 16px',
                borderRadius: 8,
                border: `1px solid ${gradeColor}`,
                fontSize: 16,
                fontWeight: 600,
                color: gradeColor,
              }}>
                Grade {scoreGrade}
              </div>
            )}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              padding: '6px 16px',
              borderRadius: 8,
              border: `1px solid ${reoColor}`,
              fontSize: 16,
              fontWeight: 600,
              color: reoColor,
            }}>
              REO: {reoLabel}
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: 'flex', gap: 16, marginTop: 40 }}>
          <StatBox label="Self-Stake" value={`${formatGRT(selfStake)} GRT`} />
          <StatBox label="Delegated" value={`${formatGRT(delegated)} GRT`} />
          <StatBox label="Allocations" value={String(allocations)} />
          <StatBox label="Rewards Earned" value={`${formatGRT(totalRewards)} GRT`} />
        </div>

        {/* APR if available */}
        {apr && (
          <div style={{ display: 'flex', marginTop: 20, gap: 16 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 24px',
              background: 'rgba(139,133,255,0.08)',
              borderRadius: 12,
              border: '1px solid rgba(139,133,255,0.2)',
            }}>
              <span style={{ fontSize: 14, color: '#9898A6', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Delegator APR
              </span>
              <span style={{ fontSize: 24, fontWeight: 700, color: '#8B85FF' }}>
                {apr}
              </span>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 'auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: '#8B85FF' }}>
              Lodestar
            </span>
            <span style={{ fontSize: 15, color: '#6B6B7B' }}>
              The Graph Protocol Analytics
            </span>
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
