'use client';

import { useId } from 'react';

interface Props {
  points: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Stable id suffix for the gradient (must be unique within the page). */
  id?: string;
}

/**
 * Smooth-curve sparkline. Pure SVG so it stays cheap to render per row, but
 * uses Catmull-Rom-to-Bezier conversion for the same monotone-curve look that
 * recharts' `<Area type="monotone">` produces (and that Lodestar's existing
 * `SubgraphHistoryChart` uses). Gradient fill matches the area-chart aesthetic
 * common to Coinbase, Kraken, and CoinGecko's mini charts.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    // Catmull-Rom (tension = 0.5) → cubic Bezier control points.
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

export function Sparkline({ points, width = 88, height = 28, className, id }: Props) {
  // Stable per-instance id for the gradient. Replaces a prior Math.random()
  // call, which violated React's purity rules and could regenerate gradients
  // on every render.
  const reactId = useId();
  if (!points || points.length < 2) {
    return <div className={className} style={{ width, height }} aria-hidden />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const padY = 2;
  const usableH = height - padY * 2;
  const dx = width / (points.length - 1);
  const xy = points.map((p, i) => ({
    x: i * dx,
    y: padY + usableH - ((p - min) / span) * usableH,
  }));

  const linePath = smoothPath(xy);
  const areaPath = `${linePath} L${xy[xy.length - 1].x.toFixed(2)},${height} L0,${height} Z`;

  const positive = points[points.length - 1] >= points[0];
  const stroke = positive ? 'var(--green)' : '#ef4444';
  const gradId = `sparkArea-${id ?? reactId.replace(/:/g, '')}-${positive ? 'p' : 'n'}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.32} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
