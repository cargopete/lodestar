import { http, createConfig } from 'wagmi';
import { arbitrum } from 'wagmi/chains';
import { injected, walletConnect, coinbaseWallet } from 'wagmi/connectors';

// WalletConnect project ID - users should set their own in .env
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo';

export const config = createConfig({
  chains: [arbitrum],
  connectors: [
    injected(),
    walletConnect({ projectId }),
    coinbaseWallet({ appName: 'Lodestar' }),
  ],
  transports: {
    [arbitrum.id]: http(),
  },
  ssr: true,
});

// Contract addresses on Arbitrum One
export const CONTRACTS = {
  // Core staking (HorizonStaking proxy)
  staking: '0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03' as const,
  // SubgraphService (Horizon)
  subgraphService: '0xb2Bb92d0DE618878E438b55D5846cfecD9301105' as const,
  // GRT Token
  grt: '0x9623063377AD1B27544C965cCd7342f7EA7e88C7' as const,
  // Graph Token Gateway (L2)
  gateway: '0x2F5e2E19A91d53Aa17f1F1D9B5C5C5dF5E92A508' as const,
} as const;

// Graph Network Subgraph ID on Arbitrum
export const SUBGRAPH_ID = 'DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp';

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
