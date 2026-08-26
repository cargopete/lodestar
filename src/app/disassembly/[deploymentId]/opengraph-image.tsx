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

function scoreColor(score: number): string {
  if (score >= 80) return '#34D399';
  if (score >= 60) return '#FBBF24';
  return '#F87171';
}

function short(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '18px 22px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' }}>
      <span style={{ fontSize: 12, color: '#9898A6', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <span style={{ fontSize: 32, fontWeight: 700, color: '#EEEEF2', marginTop: 6 }}>{value}</span>
      <span style={{ fontSize: 13, color: '#6B6B7B', marginTop: 4 }}>{sub ?? ' '}</span>
    </div>
  );
}

/** One category of the scorecard, as a labelled bar. The bar is two flex
 *  children rather than a percentage width, because satori sizes flex ratios
 *  reliably and percentages inside a nested flex row it does not. */
function CategoryBar({ name, score, note }: { name: string; score: number; note?: string }) {
  const filled = Math.max(0, Math.min(100, Math.round(score)));
  const colour = scoreColor(filled);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 16, color: '#C9C9D4' }}>{name}</span>
        <span style={{ fontSize: 17, fontWeight: 700, color: colour }}>{filled}</span>
      </div>
      <div style={{ display: 'flex', height: 8, marginTop: 10, borderRadius: 4, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexGrow: filled, background: colour, borderRadius: 4 }} />
        <div style={{ display: 'flex', flexGrow: 100 - filled }} />
      </div>
      {note && (
        <span style={{ fontSize: 13, color: '#6B6B7B', marginTop: 10, lineHeight: 1.35 }}>
          {note.length > 68 ? note.slice(0, 68) + '…' : note}
        </span>
      )}
    </div>
  );
}

function Chip({ text, tone }: { text: string; tone?: 'accent' | 'warn' }) {
  const c =
    tone === 'warn'
      ? { fg: '#F87171', bg: 'rgba(248,113,113,0.10)', bd: 'rgba(248,113,113,0.28)' }
      : tone === 'accent'
        ? { fg: '#8B85FF', bg: 'rgba(139,133,255,0.10)', bd: 'rgba(139,133,255,0.22)' }
        : { fg: '#C9C9D4', bg: 'rgba(255,255,255,0.04)', bd: 'rgba(255,255,255,0.10)' };
  return (
    <span style={{ fontSize: 15, color: c.fg, padding: '6px 14px', borderRadius: 8, background: c.bg, border: `1px solid ${c.bd}` }}>{text}</span>
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
  const totals = data?.report.totals;
  const handlers = totals ? String(totals.handlers) : '—';
  const resolved = totals?.resolvedHandlers ?? 0;
  const hosts = totals?.hostCategories ?? [];
  const flagCount = data ? data.report.scorecard.flags.filter((f) => f.level !== 'info').length : 0;
  const categories = data?.report.scorecard.categories ?? [];
  const manifest = data?.report.manifest;
  const signalGRT = data?.signal ? formatGRT(data.signal.signalledGRT) : null;
  const gradeColor = GRADE_COLOR[grade] ?? '#9898A6';

  // The chip row must stay one line: wrapping to a second pushes the stats and
  // the scorecard down and off the canvas. Budget the host chips against however
  // many leading chips this particular deployment earned.
  const leadingChips =
    (manifest?.network ? 1 : 0) +
    (manifest?.specVersion ? 1 : 0) +
    (manifest?.graft ? 1 : 0) +
    (data?.signal && data.signal.signalledGRT > 0 ? 1 : 0);
  const hostBudget = Math.max(2, 7 - leadingChips);

  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#111114', padding: '40px 56px 36px 56px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, color: '#6B6B7B', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Subgraph Disassembly</span>
            <span style={{ fontSize: 42, fontWeight: 700, color: '#EEEEF2', letterSpacing: '-0.02em' }}>Transparency Report</span>
            <span style={{ fontSize: 16, color: '#6B6B7B', fontFamily: 'monospace', marginTop: 2 }}>{short(deploymentId)}</span>
          </div>
          {/* Grade badge */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 118, height: 118, borderRadius: 20, background: 'rgba(255,255,255,0.04)', border: `2px solid ${gradeColor}` }}>
            <span style={{ fontSize: 64, fontWeight: 800, color: gradeColor, lineHeight: 1 }}>{grade}</span>
            <span style={{ fontSize: 13, color: '#9898A6', marginTop: 4 }}>risk {risk}</span>
          </div>
        </div>

        {/* What it is, before what it scored */}
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          {manifest?.network && <Chip text={manifest.network} tone="accent" />}
          {manifest?.specVersion && <Chip text={`spec ${manifest.specVersion}`} />}
          {manifest?.graft && <Chip text="Grafted" tone="warn" />}
          {data?.signal && data.signal.signalledGRT > 0 && (
            <Chip text={`${signalGRT} GRT signalled`} />
          )}
          {hosts.slice(0, hostBudget).map((h) => (
            <Chip key={h} text={h} />
          ))}
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 14, marginTop: 18 }}>
          <StatBox label="Handlers" value={handlers} sub={totals ? `${resolved} resolved in the WASM` : ' '} />
          <StatBox label="Data Sources" value={totals ? String(totals.dataSources) : '—'} sub={totals ? `${totals.templates} template${totals.templates === 1 ? '' : 's'}` : ' '} />
          <StatBox label="Risk Flags" value={String(flagCount)} sub="warn + critical" />
          <StatBox label="Module" value={totals ? formatBytes(totals.wasmBytes) : '—'} sub="Compiled size" />
        </div>

        {/* The scorecard itself — this is what fills the card, and it is the
            thing a transparency report is actually for. */}
        {categories.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', marginTop: 10 }}>
            <span style={{ fontSize: 12, color: '#6B6B7B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Scorecard</span>
            <div style={{ display: 'flex', gap: 22 }}>
              {categories.slice(0, 4).map((c) => (
                <CategoryBar key={c.name} name={c.name} score={c.score} note={c.note} />
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 20 }}>
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
