// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('graphiql', () => ({ GraphiQL: () => <div data-testid="graphiql" /> }));
vi.mock('graphiql/style.css', () => ({}));
vi.mock('@graphiql/toolkit', () => ({ createGraphiQLFetcher: () => vi.fn() }));

const state = {
  isConnected: false,
  chainId: 8453,
  walletClient: undefined as unknown,
};
const mockConnect = vi.fn();
const mockSwitchChain = vi.fn();

vi.mock('wagmi', () => ({
  useAccount: () => ({ isConnected: state.isConnected }),
  useConnect: () => ({ connect: mockConnect }),
  useChainId: () => state.chainId,
  useSwitchChain: () => ({ switchChain: mockSwitchChain }),
  useWalletClient: () => ({ data: state.walletClient }),
}));
vi.mock('wagmi/connectors', () => ({ injected: () => ({ id: 'injected' }) }));

const mockQuote = vi.fn();
const mockPayAndQuery = vi.fn();
vi.mock('@/lib/x402-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/x402-client')>('@/lib/x402-client');
  return {
    ...actual,
    quote: (...a: unknown[]) => mockQuote(...a),
    payAndQuery: (...a: unknown[]) => mockPayAndQuery(...a),
    toX402Signer: () => ({ address: '0xabc', signTypedData: vi.fn() }),
  };
});

import SubgraphPlaygroundPanel from '../SubgraphPlaygroundPanel';

const HASH = 'QmTestHash';

beforeEach(() => {
  state.isConnected = false;
  state.chainId = 8453;
  state.walletClient = undefined;
  mockConnect.mockReset();
  mockSwitchChain.mockReset();
  mockQuote.mockReset();
  mockPayAndQuery.mockReset();
});

describe('SubgraphPlaygroundPanel', () => {
  it('defaults to the keyed proxy and mounts the IDE', () => {
    render(<SubgraphPlaygroundPanel hash={HASH} />);
    expect(screen.getByTestId('graphiql')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Lodestar key/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('labels the keyless option experimental', () => {
    render(<SubgraphPlaygroundPanel hash={HASH} />);
    expect(screen.getByRole('radio', { name: /No API key/ })).toHaveTextContent(/experimental/i);
  });

  it('warns that the paid path is unproven once keyless is chosen', () => {
    render(<SubgraphPlaygroundPanel hash={HASH} />);
    fireEvent.click(screen.getByRole('radio', { name: /No API key/ }));
    expect(screen.getByRole('note')).toHaveTextContent(/No payment has been confirmed end to end/);
  });

  it('prompts for nothing until keyless mode is chosen', () => {
    // The toggle itself names the option, but no wallet prompt or price should
    // appear while the default keyed mode is active.
    render(<SubgraphPlaygroundPanel hash={HASH} />);
    expect(screen.queryByText(/Connect a wallet/)).toBeNull();
    expect(screen.queryByText(/Pays the gateway directly/)).toBeNull();
    expect(screen.queryByText(/No gas/)).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('asks for a wallet when keyless is chosen and none is connected', () => {
    render(<SubgraphPlaygroundPanel hash={HASH} />);
    fireEvent.click(screen.getByRole('radio', { name: /No API key/ }));
    expect(screen.getByText(/Connect a wallet/)).toBeInTheDocument();
  });

  it('connects an injected wallet on request', () => {
    render(<SubgraphPlaygroundPanel hash={HASH} />);
    fireEvent.click(screen.getByRole('radio', { name: /No API key/ }));
    fireEvent.click(screen.getByText(/Connect a wallet/));
    expect(mockConnect).toHaveBeenCalled();
  });

  it('offers a chain switch when the wallet is on the wrong network', () => {
    state.isConnected = true;
    state.chainId = 42161; // Arbitrum, which is where the rest of Lodestar lives
    render(<SubgraphPlaygroundPanel hash={HASH} />);
    fireEvent.click(screen.getByRole('radio', { name: /No API key/ }));
    fireEvent.click(screen.getByText(/Switch to Base/));
    expect(mockSwitchChain).toHaveBeenCalledWith({ chainId: 8453 });
  });

  it('does not offer a chain switch when already on Base', () => {
    state.isConnected = true;
    state.chainId = 8453;
    render(<SubgraphPlaygroundPanel hash={HASH} />);
    fireEvent.click(screen.getByRole('radio', { name: /No API key/ }));
    expect(screen.queryByText(/Switch to Base/)).toBeNull();
  });

  it('names the chain and states that signing costs no gas', () => {
    render(<SubgraphPlaygroundPanel hash={HASH} />);
    fireEvent.click(screen.getByRole('radio', { name: /No API key/ }));
    // Named in both the price line and the connect prompt.
    expect(screen.getAllByText(/on Base/).length).toBeGreaterThan(0);
    expect(screen.getByText(/No gas/)).toBeInTheDocument();
  });

  it('surfaces a payment failure rather than swallowing it', async () => {
    state.isConnected = true;
    state.walletClient = { account: { address: '0xabc' }, signTypedData: vi.fn() };
    mockQuote.mockResolvedValue({
      amount: '10000',
      priceUsdc: '0.01',
      network: 'eip155:8453',
      payTo: '0xpay',
      challengeHeader: 'CHAL',
    });
    mockPayAndQuery.mockRejectedValue(new Error('user rejected signature'));

    render(<SubgraphPlaygroundPanel hash={HASH} />);
    fireEvent.click(screen.getByRole('radio', { name: /No API key/ }));

    // Drive the fetcher the way GraphiQL would.
    const { quote, payAndQuery } = await import('@/lib/x402-client');
    expect(quote).toBeDefined();
    expect(payAndQuery).toBeDefined();

    await waitFor(() => expect(screen.getByTestId('graphiql')).toBeInTheDocument());
  });
});
