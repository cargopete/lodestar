// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EpochTable } from '../EpochTable';
import type { Epoch } from '@/lib/queries';

function epoch(id: string): Epoch {
  return {
    id,
    startBlock: 100,
    endBlock: 200,
    signalledTokens: '0',
    stakeDeposited: '0',
    totalQueryFees: '1000000000000000000',
    totalRewards: '2000000000000000000',
    totalIndexerRewards: '0',
    totalDelegatorRewards: '0',
  };
}

describe('EpochTable', () => {
  it('renders a status badge derived from the current epoch', () => {
    render(<EpochTable epochs={[epoch('1274'), epoch('1273'), epoch('1271')]} currentEpoch={1274} />);
    expect(screen.getByText('Active')).toBeInTheDocument();    // 1274
    expect(screen.getByText('Settling')).toBeInTheDocument();  // 1273
    expect(screen.getByText('Finalized')).toBeInTheDocument(); // 1271
  });

  it('renders one row per epoch with its number', () => {
    render(<EpochTable epochs={[epoch('1274'), epoch('1273')]} currentEpoch={1274} />);
    expect(screen.getByText('1274')).toBeInTheDocument();
    expect(screen.getByText('1273')).toBeInTheDocument();
  });

  it('shows an empty state when there are no epochs', () => {
    render(<EpochTable epochs={[]} currentEpoch={1274} />);
    expect(screen.getByText(/No epoch data/i)).toBeInTheDocument();
  });
});
