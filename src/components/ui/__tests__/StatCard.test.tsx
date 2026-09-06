// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from '../StatCard';

describe('StatCard', () => {
  it('renders the value it is given', () => {
    render(<StatCard label="Total Staked" value="1.23B GRT" />);
    expect(screen.getByText('1.23B GRT')).toBeInTheDocument();
  });

  // The bug this guards: /api/network-stats 503s, `data` is undefined, the caller's
  // `network ? weiToGRT(...) : 0` fallback produces 0, and the card reports "0.00 GRT" as though the
  // network had emptied. An unreachable source must never be rendered as a figure.
  it('renders "Unavailable" instead of the fallback value when the source is down', () => {
    render(<StatCard label="Total Staked" value="0.00 GRT" unavailable />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('0.00 GRT')).not.toBeInTheDocument();
  });

  it('suppresses the subtitle and delta when unavailable, since both come from the same absent payload', () => {
    render(
      <StatCard
        label="Indexers"
        value="0"
        subtitle="0 total"
        delta={{ value: '5.00%', positive: true }}
        unavailable
      />
    );
    expect(screen.queryByText('0 total')).not.toBeInTheDocument();
    expect(screen.queryByText(/5\.00%/)).not.toBeInTheDocument();
  });

  it('prefers the loading shimmer over "Unavailable" while the fetch is still in flight', () => {
    render(<StatCard label="Total Staked" value="0.00 GRT" loading unavailable />);
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00 GRT')).not.toBeInTheDocument();
  });
});
