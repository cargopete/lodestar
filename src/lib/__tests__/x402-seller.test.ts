/**
 * The seller side of x402.
 *
 * The load-bearing test is `a_signature_made_by_viem_typed_data_verifies`: the digest in
 * `x402-seller.ts` is hand-written, and a wrong EIP-712 construction recovers to *some* address
 * rather than failing loudly — so it looks like a forged payment instead of like our bug. Signing
 * with an independent implementation of the same standard and requiring it to verify is the only
 * check that catches that. Same trap, and same remedy, as the RCA hashing in weaver.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, toHex, type Hex } from 'viem';

import {
  SELLER_CHAINS,
  buildChallenge,
  encodeChallenge,
  sellerConfig,
  verifyPayment,
  type SellerConfig,
} from '../x402-seller';

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const account = privateKeyToAccount(KEY);

const CFG: SellerConfig = {
  network: 'testnet',
  payTo: '0x1111111111111111111111111111111111111111',
  priceBaseUnits: 1000n,
};

const NOW = 1_800_000_000;

/** Sign an EIP-3009 authorisation the way a real payer's wallet would. */
async function signAuthorization(over: Partial<Record<string, unknown>> = {}, cfg = CFG) {
  const chain = SELLER_CHAINS[cfg.network];
  const authorization = {
    from: account.address,
    to: cfg.payTo as Hex,
    value: cfg.priceBaseUnits,
    validAfter: BigInt(NOW - 60),
    validBefore: BigInt(NOW + 600),
    nonce: keccak256(toHex('nonce-1')),
    ...over,
  } as {
    from: Hex;
    to: Hex;
    value: bigint;
    validAfter: bigint;
    validBefore: bigint;
    nonce: Hex;
  };

  const signature = await account.signTypedData({
    domain: {
      name: chain.assetName,
      version: chain.assetVersion,
      chainId: chain.chainId,
      verifyingContract: chain.asset as Hex,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: authorization,
  });

  return Buffer.from(
    JSON.stringify({
      x402Version: 1,
      scheme: 'exact',
      network: chain.network,
      payload: {
        signature,
        authorization: {
          from: authorization.from,
          to: authorization.to,
          value: authorization.value.toString(),
          validAfter: authorization.validAfter.toString(),
          validBefore: authorization.validBefore.toString(),
          nonce: authorization.nonce,
        },
      },
    }),
    'utf8'
  ).toString('base64');
}

describe('the typehash', () => {
  it('is the one EIP-3009 specifies, recomputed rather than trusted', () => {
    expect(
      keccak256(
        toHex(
          'TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)'
        )
      )
    ).toBe('0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267');
  });
});

describe('the challenge', () => {
  it('is the shape the buyer side already parses', () => {
    const c = buildChallenge(CFG, 'https://x/api/sql/query', 'One query');
    expect(c.x402Version).toBe(1);
    const tag = c.accepts[0];
    expect(tag.network).toBe(SELLER_CHAINS.testnet.network);
    expect(tag.asset).toBe(SELLER_CHAINS.testnet.asset);
    expect(tag.payTo).toBe(CFG.payTo);
    expect(tag.amount).toBe('1000');
    expect(tag.scheme).toBe('exact');
  });

  it('round-trips through the base64 the header carries', () => {
    const c = buildChallenge(CFG, 'https://x', 'y');
    const back = JSON.parse(Buffer.from(encodeChallenge(c), 'base64').toString('utf8'));
    expect(back).toEqual(JSON.parse(JSON.stringify(c)));
  });
});

describe('verifyPayment', () => {
  it('accepts a signature made by an independent EIP-712 implementation', async () => {
    const r = await verifyPayment(CFG, await signAuthorization(), NOW);
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    if (r.ok) {
      expect(r.from.toLowerCase()).toBe(account.address.toLowerCase());
      expect(r.value).toBe(1000n);
    }
  });

  it('accepts an overpayment, because more than the price is still the price', async () => {
    const r = await verifyPayment(CFG, await signAuthorization({ value: 5000n }), NOW);
    expect(r.ok).toBe(true);
  });

  it('refuses an underpayment', async () => {
    const r = await verifyPayment(CFG, await signAuthorization({ value: 999n }), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('999');
  });

  // The field every check exists for: a beautifully signed payment to somebody else is not a
  // payment to us, and checking it against the payment's own claims rather than our configuration
  // is how that gets missed.
  it('refuses a payment addressed to another recipient', async () => {
    const r = await verifyPayment(
      CFG,
      await signAuthorization({ to: '0x2222222222222222222222222222222222222222' as Hex }),
      NOW
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('somebody else');
  });

  it('refuses a payment signed by someone other than the stated payer', async () => {
    // Sign correctly, then rewrite `from`. The signature no longer recovers to it.
    const good = await signAuthorization();
    const obj = JSON.parse(Buffer.from(good, 'base64').toString('utf8'));
    obj.payload.authorization.from = '0x3333333333333333333333333333333333333333';
    const tampered = Buffer.from(JSON.stringify(obj)).toString('base64');
    const r = await verifyPayment(CFG, tampered, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('does not match');
  });

  it('refuses an authorization whose window has closed', async () => {
    const r = await verifyPayment(CFG, await signAuthorization(), NOW + 100_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('expired');
  });

  it('refuses an authorization whose window has not opened', async () => {
    const r = await verifyPayment(CFG, await signAuthorization(), NOW - 100_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not yet valid');
  });

  it('refuses a payment for the wrong network', async () => {
    const good = await signAuthorization();
    const obj = JSON.parse(Buffer.from(good, 'base64').toString('utf8'));
    obj.network = 'eip155:1';
    const r = await verifyPayment(CFG, Buffer.from(JSON.stringify(obj)).toString('base64'), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('eip155:1');
  });

  it.each(['not base64 at all', Buffer.from('{}').toString('base64')])(
    'refuses malformed payment header %j',
    async (bad) => {
      const r = await verifyPayment(CFG, bad, NOW);
      expect(r.ok).toBe(false);
    }
  );
});

describe('configuration', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.X402_SELL_PAY_TO;
    delete process.env.X402_SELL_NETWORK;
    delete process.env.X402_SELL_PRICE;
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllEnvs();
  });

  // Unconfigured means free, which is today's behaviour. A paywall that switches itself on by
  // default would start charging for something that was free, silently.
  it('is off unless a receiving address is set', () => {
    expect(sellerConfig()).toBeNull();
  });

  it('refuses a receiving address that is not an address', () => {
    process.env.X402_SELL_PAY_TO = 'not-an-address';
    expect(() => sellerConfig()).toThrow(/20-byte address/);
  });

  it('defaults to testnet, because charging real money must be deliberate', () => {
    process.env.X402_SELL_PAY_TO = CFG.payTo;
    expect(sellerConfig()!.network).toBe('testnet');
    process.env.X402_SELL_NETWORK = 'mainnet';
    expect(sellerConfig()!.network).toBe('mainnet');
  });

  it('refuses a non-positive price rather than serving for nothing while claiming a charge', () => {
    process.env.X402_SELL_PAY_TO = CFG.payTo;
    process.env.X402_SELL_PRICE = '0';
    expect(() => sellerConfig()).toThrow(/positive/);
  });
});
