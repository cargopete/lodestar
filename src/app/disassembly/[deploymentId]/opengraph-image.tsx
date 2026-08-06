import { ImageResponse } from 'next/og';
import { loadShareReport } from '@/lib/disassembly/share';
import { formatGRT } from '@/lib/utils';

// Node runtime (not edge): lets us reuse runDisassembly + the Redis cache via
// loadShareReport instead of re-fetching over HTTP.
export const runtime = 'nodejs';
export const alt = 'Subgraph Disassembly | Lodestar';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const GRADE_COLOR: Record<string, string> = {
  A: '#34D399', B: '#34D399', C: '#FBBF24', D: '#F87171', F: '#F87171',
};

function short(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '20px 24px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' }}>
      <span style={{ fontSize: 12, color: '#9898A6', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <span style={{ fontSize: 28, fontWeight: 700, color: '#EEEEF2', marginTop: 6 }}>{value}</span>
      {sub && <span style={{ fontSize: 13, color: '#6B6B7B', marginTop: 4 }}>{sub}</span>}
    </div>
  );
}

export default async function OGImage({
  params,
}: {
  params: Promise<{ deploymentId: string }>;
}) {
  const { deploymentId } = await params;
  const data = await loadShareReport(deploymentId);

  const grade = data?.report.scorecard.grade ?? '—';
  const risk = data ? String(data.report.scorecard.riskScore) : '—';
  const handlers = data ? String(data.report.totals.handlers) : '—';
  const hosts = data?.report.totals.hostCategories ?? [];
  const flagCount = data ? data.report.scorecard.flags.filter((f) => f.level !== 'info').length : 0;
  const signalGRT = data?.signal ? formatGRT(data.signal.signalledGRT) : null;
  const gradeColor = GRADE_COLOR[grade] ?? '#9898A6';

  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#111114', padding: '48px 56px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, color: '#6B6B7B', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Subgraph Disassembly</span>
            <span style={{ fontSize: 44, fontWeight: 700, color: '#EEEEF2', letterSpacing: '-0.02em' }}>Transparency Report</span>
            <span style={{ fontSize: 16, color: '#6B6B7B', fontFamily: 'monospace', marginTop: 4 }}>{short(deploymentId)}</span>
          </div>
          {/* Grade badge */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 130, height: 130, borderRadius: 20, background: 'rgba(255,255,255,0.04)', border: `2px solid ${gradeColor}` }}>
            <span style={{ fontSize: 72, fontWeight: 800, color: gradeColor, lineHeight: 1 }}>{grade}</span>
            <span style={{ fontSize: 13, color: '#9898A6', marginTop: 4 }}>risk {risk}</span>
          </div>
        </div>

        {/* Host APIs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 40 }}>
          {hosts.slice(0, 8).map((h) => (
            <span key={h} style={{ fontSize: 16, color: '#C9C9D4', padding: '6px 14px', borderRadius: 8, background: 'rgba(139,133,255,0.1)', border: '1px solid rgba(139,133,255,0.2)' }}>{h}</span>
          ))}
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 16, marginTop: 28 }}>
          <StatBox label="Handlers" value={handlers} />
          <StatBox label="Host APIs" value={String(hosts.length)} />
          <StatBox label="Risk Flags" value={String(flagCount)} sub="warn + critical" />
          {signalGRT && <StatBox label="Signalled" value={`${signalGRT} GRT`} />}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: '#8B85FF' }}>Lodestar</span>
            <span style={{ fontSize: 15, color: '#6B6B7B' }}>Static analysis · no build, no execution</span>
          </div>
          <span style={{ fontSize: 14, color: '#6B6B7B' }}>The Graph Protocol</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
