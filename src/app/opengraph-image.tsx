import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Lodestar — The Graph Protocol Analytics';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: '#111114',
          padding: '64px 72px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          position: 'relative',
        }}
      >
        {/* Accent gradient blob */}
        <div
          style={{
            position: 'absolute',
            top: -120,
            right: -120,
            width: 480,
            height: 480,
            borderRadius: 240,
            background: 'radial-gradient(circle, rgba(139,133,255,0.15) 0%, rgba(139,133,255,0) 70%)',
          }}
        />

        {/* Main content */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {/* Logo + wordmark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: 'linear-gradient(135deg, #8B85FF 0%, #6C63FF 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 26,
                fontWeight: 800,
                color: '#FFFFFF',
              }}
            >
              L
            </div>
            <span style={{ fontSize: 32, fontWeight: 700, color: '#EEEEF2', letterSpacing: '-0.02em' }}>
              Lodestar
            </span>
          </div>

          {/* Tagline */}
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 48 }}>
            <span
              style={{
                fontSize: 64,
                fontWeight: 800,
                color: '#EEEEF2',
                lineHeight: 1.1,
                letterSpacing: '-0.03em',
              }}
            >
              Stay oriented.
            </span>
            <span
              style={{
                fontSize: 24,
                color: '#9898A6',
                marginTop: 16,
                lineHeight: 1.5,
              }}
            >
              Staking analytics, indexer intelligence, and portfolio
              tracking for The Graph Protocol.
            </span>
          </div>

          {/* Feature pills */}
          <div style={{ display: 'flex', gap: 12, marginTop: 44 }}>
            {['Indexer Analytics', 'Delegation Tracking', 'Subgraph Explorer', 'Network Health'].map(
              (label) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    padding: '8px 18px',
                    borderRadius: 100,
                    border: '1px solid rgba(139,133,255,0.25)',
                    background: 'rgba(139,133,255,0.06)',
                    fontSize: 15,
                    color: '#9898A6',
                  }}
                >
                  {label}
                </div>
              )
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            paddingTop: 24,
          }}
        >
          <span style={{ fontSize: 16, color: '#6B6B7B' }}>lodestar-dashboard.com</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: 4, background: '#34D399' }} />
            <span style={{ fontSize: 15, color: '#6B6B7B' }}>The Graph Protocol</span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
