/**
 * TAP v2 (GraphTallyCollector) receipt signing and escrow management.
 *
 * The dashboard acts as a TAP payer so users can query bounty subgraphs
 * through any indexer without needing their own GRT escrow.
 *
 * Contracts on Arbitrum One (42161):
 *   GraphTallyCollector  0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e
 *   PaymentsEscrow       0xf6Fcc27aAf1fcD8B254498c9794451d82afC673E
 *   GRT (L2)             0x9623063377AD1B27544C965cCd7342f7EA7e88C7
 *   SubgraphService      0xb2Bb92d0DE618878E438b55D5846cfecD9301105
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum } from 'viem/chains';

// ── Constants ────────────────────────────────────────────────────────────────

const GRAPH_TALLY_COLLECTOR = '0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e' as const;
const SUBGRAPH_SERVICE      = '0xb2Bb92d0DE618878E438b55D5846cfecD9301105' as const;
const PAYMENTS_ESCROW       = '0xf6Fcc27aAf1fcD8B254498c9794451d82afC673E' as const;
const GRT_TOKEN             = '0x9623063377AD1B27544C965cCd7342f7EA7e88C7' as const;

// Minimum escrow (wei) before we top up — 1 GRT should last ~10^18 playground queries.
export const MIN_ESCROW_WEI = 1_000_000_000_000_000_000n; // 1 GRT

// EIP-712 domain for GraphTallyCollector on Arbitrum One.
const TAP_DOMAIN = {
  name: 'GraphTallyCollector',
  version: '1',
  chainId: 42161,
  verifyingContract: GRAPH_TALLY_COLLECTOR,
} as const;

// Receipt type — mirrors the Solidity struct in GraphTallyCollector.
const RECEIPT_TYPES = {
  Receipt: [
    { name: 'data_service',      type: 'address' },
    { name: 'service_provider',  type: 'address' },
    { name: 'timestamp_ns',      type: 'uint64'  },
    { name: 'nonce',             type: 'uint64'  },
    { name: 'value',             type: 'uint128' },
    { name: 'metadata',          type: 'bytes'   },
  ],
} as const;

const ESCROW_ABI = parseAbi([
  'function getBalance(address payer, address collector, address receiver) external view returns (uint256)',
  'function deposit(address collector, address receiver, uint256 amount) external',
]);

const GRT_ABI = parseAbi([
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function rpcUrl(): string {
  return process.env.ARBITRUM_RPC_URL ?? 'https://gateway.lodestar-dashboard.com/rpc/42161';
}

function getPublicClient() {
  return createPublicClient({ chain: arbitrum, transport: http(rpcUrl()) });
}

function getAccount() {
  const key = process.env.TAP_SIGNER_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error('TAP_SIGNER_PRIVATE_KEY not configured');
  return privateKeyToAccount(key);
}

// ── Public API ───────────────────────────────────────────────────────────────

export function hasTapSigner(): boolean {
  return !!process.env.TAP_SIGNER_PRIVATE_KEY;
}

/**
 * Sign a TAP v2 receipt for a subgraph query to `indexerAddress`.
 * Returns the JSON string to pass as the `TAP-Receipt` HTTP header value,
 * or null if TAP_SIGNER_PRIVATE_KEY is not configured.
 *
 * Receipt value is 1 wei (essentially free). The indexer accumulates receipts
 * and redeems them via the TAP aggregator — the payer's escrow covers the total.
 */
export async function signTapReceipt(indexerAddress: string): Promise<string | null> {
  if (!hasTapSigner()) return null;

  const account = getAccount();

  // Normalise timestamp through float64 so that JSON serialization and EIP-712
  // signing use the same integer value. float64 loses ~512 ns of precision at
  // the current epoch — well within the indexer's 60-second window check.
  const tsNs = BigInt(Math.trunc(Date.now() * 1_000_000));
  const nonce = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

  const message = {
    data_service:     SUBGRAPH_SERVICE as Hex,
    service_provider: indexerAddress.toLowerCase() as Hex,
    timestamp_ns:     tsNs,
    nonce,
    value:            1n, // 1 wei GRT
    metadata:         '0x' as Hex,
  };

  const signature = await account.signTypedData({
    domain:      TAP_DOMAIN,
    types:       RECEIPT_TYPES,
    primaryType: 'Receipt',
    message,
  });

  // Serialize. timestamp_ns / nonce may lose ~512 ns / 0 precision in float64
  // but Rust's serde_json will parse the same value that was signed.
  return JSON.stringify({
    receipt: {
      data_service:     message.data_service,
      service_provider: message.service_provider,
      timestamp_ns:     Number(tsNs),
      nonce:            Number(nonce),
      value:            Number(message.value),
      metadata:         message.metadata,
    },
    signature,
  });
}

/**
 * Return our escrow balance (wei) with a given indexer.
 */
export async function getEscrowBalance(indexerAddress: string): Promise<bigint> {
  const account = getAccount();
  const client = getPublicClient();

  return client.readContract({
    address: PAYMENTS_ESCROW,
    abi: ESCROW_ABI,
    functionName: 'getBalance',
    args: [account.address, GRAPH_TALLY_COLLECTOR, indexerAddress as Hex],
  });
}

/**
 * Ensure we have at least MIN_ESCROW_WEI in escrow with `indexerAddress`.
 * Deposits 1 GRT if below threshold. Approves GRT allowance if needed.
 * No-op if already funded.
 *
 * Note: after a deposit the indexer-service refreshes its escrow cache in up
 * to 60 seconds — allow for that delay before expecting receipts to be accepted.
 */
export async function ensureEscrow(indexerAddress: string): Promise<void> {
  const account = getAccount();
  const client = getPublicClient();
  const walletClient = createWalletClient({
    account,
    chain: arbitrum,
    transport: http(rpcUrl()),
  });

  const balance = await client.readContract({
    address: PAYMENTS_ESCROW,
    abi: ESCROW_ABI,
    functionName: 'getBalance',
    args: [account.address, GRAPH_TALLY_COLLECTOR, indexerAddress as Hex],
  });

  if (balance >= MIN_ESCROW_WEI) return; // already funded

  const deposit = MIN_ESCROW_WEI;

  // Approve GRT if allowance is insufficient.
  const allowance = await client.readContract({
    address: GRT_TOKEN,
    abi: GRT_ABI,
    functionName: 'allowance',
    args: [account.address, PAYMENTS_ESCROW],
  });

  if (allowance < deposit) {
    const approveTx = await walletClient.writeContract({
      address: GRT_TOKEN,
      abi: GRT_ABI,
      functionName: 'approve',
      args: [PAYMENTS_ESCROW, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
    });
    await client.waitForTransactionReceipt({ hash: approveTx });
  }

  const depositTx = await walletClient.writeContract({
    address: PAYMENTS_ESCROW,
    abi: ESCROW_ABI,
    functionName: 'deposit',
    args: [GRAPH_TALLY_COLLECTOR, indexerAddress as Hex, deposit],
  });
  await client.waitForTransactionReceipt({ hash: depositTx });
}
