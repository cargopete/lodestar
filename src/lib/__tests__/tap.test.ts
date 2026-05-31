/**
 * Unit tests for src/lib/tap.ts — TAP v2 receipt signing + escrow management.
 * viem is fully mocked: we assert on the receipt JSON shape, the EIP-712
 * arguments, and the escrow deposit/approve flow rather than touching a chain.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- viem mocks -------------------------------------------------------------
const signTypedData = vi.fn();
const readContract = vi.fn();
const writeContract = vi.fn();
const waitForTransactionReceipt = vi.fn();

const FAKE_ADDRESS = '0x00000000000000000000000000000000000005ec';

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ readContract, waitForTransactionReceipt })),
    createWalletClient: vi.fn(() => ({ writeContract })),
    http: vi.fn(() => ({})),
  };
});

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(() => ({ address: FAKE_ADDRESS, signTypedData })),
}));

const INDEXER = '0x00000000000000000000000000000000000000A1';
const MIN = 1_000_000_000_000_000_000n;

async function load() {
  return import('@/lib/tap');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.TAP_SIGNER_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
});

afterEach(() => {
  delete process.env.TAP_SIGNER_PRIVATE_KEY;
});

describe('hasTapSigner', () => {
  it('true when key is set', async () => {
    const { hasTapSigner } = await load();
    expect(hasTapSigner()).toBe(true);
  });

  it('false when key is unset', async () => {
    delete process.env.TAP_SIGNER_PRIVATE_KEY;
    const { hasTapSigner } = await load();
    expect(hasTapSigner()).toBe(false);
  });
});

describe('MIN_ESCROW_WEI', () => {
  it('is exactly 1 GRT', async () => {
    const { MIN_ESCROW_WEI } = await load();
    expect(MIN_ESCROW_WEI).toBe(MIN);
  });
});

describe('signTapReceipt', () => {
  it('returns null when no signer configured', async () => {
    delete process.env.TAP_SIGNER_PRIVATE_KEY;
    const { signTapReceipt } = await load();
    expect(await signTapReceipt(INDEXER)).toBeNull();
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it('produces a serializable receipt with lowercased provider, value 1 wei, and signature', async () => {
    signTypedData.mockResolvedValueOnce('0xdeadbeef');
    const { signTapReceipt } = await load();
    const out = await signTapReceipt(INDEXER);
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out!);
    expect(parsed.signature).toBe('0xdeadbeef');
    expect(parsed.receipt.service_provider).toBe(INDEXER.toLowerCase());
    expect(parsed.receipt.value).toBe(1);
    expect(parsed.receipt.metadata).toBe('0x');
    // data_service is the SubgraphService address
    expect(parsed.receipt.data_service).toBe('0xb2Bb92d0DE618878E438b55D5846cfecD9301105');
    // timestamp/nonce serialize to JS numbers (float64-safe)
    expect(typeof parsed.receipt.timestamp_ns).toBe('number');
    expect(typeof parsed.receipt.nonce).toBe('number');
  });

  it('signs with the GraphTallyCollector EIP-712 domain + Receipt primary type', async () => {
    signTypedData.mockResolvedValueOnce('0xsig');
    const { signTapReceipt } = await load();
    await signTapReceipt(INDEXER);
    expect(signTypedData).toHaveBeenCalledTimes(1);
    const arg = signTypedData.mock.calls[0][0];
    expect(arg.primaryType).toBe('Receipt');
    expect(arg.domain).toMatchObject({
      name: 'GraphTallyCollector',
      version: '1',
      chainId: 42161,
      verifyingContract: '0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e',
    });
    expect(arg.message.value).toBe(1n);
    expect(arg.message.service_provider).toBe(INDEXER.toLowerCase());
  });

  it('throws if signing is attempted with no key after has-check bypass', async () => {
    // signTapReceipt guards with hasTapSigner, but getAccount throws if key vanishes.
    // Confirm getEscrowBalance surfaces the missing-key error.
    delete process.env.TAP_SIGNER_PRIVATE_KEY;
    const { getEscrowBalance } = await load();
    await expect(getEscrowBalance(INDEXER)).rejects.toThrow(/TAP_SIGNER_PRIVATE_KEY/);
  });
});

describe('getEscrowBalance', () => {
  it('reads PaymentsEscrow.getBalance with payer/collector/receiver args', async () => {
    readContract.mockResolvedValueOnce(42n);
    const { getEscrowBalance } = await load();
    const bal = await getEscrowBalance(INDEXER);
    expect(bal).toBe(42n);
    expect(readContract).toHaveBeenCalledTimes(1);
    const arg = readContract.mock.calls[0][0];
    expect(arg.functionName).toBe('getBalance');
    expect(arg.address).toBe('0xf6Fcc27aAf1fcD8B254498c9794451d82afC673E');
    expect(arg.args[0]).toBe(FAKE_ADDRESS); // payer = our account
    expect(arg.args[1]).toBe('0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e'); // collector
    expect(arg.args[2]).toBe(INDEXER); // receiver
  });
});

describe('ensureEscrow', () => {
  it('no-ops when balance already >= MIN', async () => {
    readContract.mockResolvedValueOnce(MIN); // getBalance
    const { ensureEscrow } = await load();
    await ensureEscrow(INDEXER);
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('approves then deposits when balance is low and allowance insufficient', async () => {
    readContract
      .mockResolvedValueOnce(0n) // getBalance
      .mockResolvedValueOnce(0n); // allowance
    writeContract
      .mockResolvedValueOnce('0xapprovetx')
      .mockResolvedValueOnce('0xdeposittx');
    waitForTransactionReceipt.mockResolvedValue({});
    const { ensureEscrow } = await load();
    await ensureEscrow(INDEXER);

    expect(writeContract).toHaveBeenCalledTimes(2);
    const approve = writeContract.mock.calls[0][0];
    const deposit = writeContract.mock.calls[1][0];
    expect(approve.functionName).toBe('approve');
    expect(deposit.functionName).toBe('deposit');
    expect(deposit.args).toEqual([
      '0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e',
      INDEXER,
      MIN,
    ]);
    // waits for both receipts
    expect(waitForTransactionReceipt).toHaveBeenCalledTimes(2);
  });

  it('skips approve when allowance already sufficient, still deposits', async () => {
    const big = MIN * 10n;
    readContract
      .mockResolvedValueOnce(0n) // getBalance below MIN
      .mockResolvedValueOnce(big); // allowance >= deposit
    writeContract.mockResolvedValueOnce('0xdeposittx');
    waitForTransactionReceipt.mockResolvedValue({});
    const { ensureEscrow } = await load();
    await ensureEscrow(INDEXER);

    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(writeContract.mock.calls[0][0].functionName).toBe('deposit');
    expect(waitForTransactionReceipt).toHaveBeenCalledTimes(1);
  });
});
