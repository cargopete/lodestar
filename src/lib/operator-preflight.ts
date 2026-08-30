/**
 * Rehearsing the operator sequence for somebody, before they spend anything.
 *
 * [`becoming-an-operator.md`](../../docs/becoming-an-operator.md) says to rehearse on a fork before
 * you spend anything, which is right and asks a prospective operator to install Foundry and write a
 * Solidity test before they have decided whether they care. Most of what a fork rehearsal tells you
 * is readable straight off mainnet with `eth_call`, for free, from a browser, given only an address.
 *
 * So this takes an address and a service and reports what would happen. **No wallet, no signature,
 * no gas**: you can paste somebody else's address, or one you have not funded yet, and see the
 * shape of the job.
 *
 * The check that earns its place is the first one. Several Horizon addresses in circulation are
 * implementations rather than proxies, and calling an implementation **does not revert**. The
 * usual telling of this trap is that uninitialised storage makes views return zero, which is true
 * and is the *benign* half: a zero is obviously wrong and gets caught.
 *
 * The other half was measured on 2026-08-30 and is worse. The stray `RPCDataService`
 * implementation at `0xA983…`, which our own configs pointed at for months, **is** initialised. It
 * returns the same thawing range, the same verifier cut and the same owner as the live proxy, and
 * a minimum provision of **10,000 GRT where the live proxy says 555**. Four answers right, one
 * eighteenfold wrong, and nothing anywhere says so.
 *
 * That trap has no error to decode and no failing transaction to inspect. It does have a
 * definitive test, which is whether the EIP-1967 implementation slot holds anything.
 */

import { erc20Abi, formatUnits, type PublicClient } from 'viem';
import type { RequirementsJson } from './operator-requirements';

/** GRT on Arbitrum One. */
export const GRT_TOKEN = '0x9623063377AD1B27544C965cCd7342f7EA7e88C7' as const;

/** HorizonStaking's proxy on Arbitrum One. Resolve from the Controller if you are ever unsure. */
export const HORIZON_STAKING = '0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03' as const;

/** `bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)`. */
export const EIP1967_IMPLEMENTATION_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const;

const STAKING_ABI = [
  {
    type: 'function',
    name: 'getIdleStake',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getStake',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getProvision',
    inputs: [{ type: 'address' }, { type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'tokens', type: 'uint256' },
          { name: 'tokensThawing', type: 'uint256' },
          { name: 'sharesThawing', type: 'uint256' },
          { name: 'maxVerifierCut', type: 'uint32' },
          { name: 'thawingPeriod', type: 'uint64' },
          { name: 'createdAt', type: 'uint64' },
          { name: 'maxVerifierCutPending', type: 'uint32' },
          { name: 'thawingPeriodPending', type: 'uint64' },
          { name: 'lastParametersStagedAt', type: 'uint256' },
          { name: 'thawingNonce', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;

export type StepStatus =
  /** Already true. Nothing to do. */
  | 'done'
  /** Not true yet, and doing it is the ordinary next move. */
  | 'todo'
  /** Not true, and something has to change before it can be. */
  | 'blocked'
  /** Could not be established. Never conflated with 'fine'. */
  | 'unknown';

export interface PreflightStep {
  key: string;
  title: string;
  status: StepStatus;
  detail: string;
}

export interface PreflightInput {
  /** What the address holds and has staked, in wei. */
  grtBalance: bigint;
  stake: bigint;
  idleStake: bigint;
  /** Tokens already provisioned to this service, and on what terms. */
  provisionTokens: bigint;
  provisionThawingSeconds: bigint;
  /** Whether the registry currently lists this address as a provider. */
  registered: boolean;
  /** `null` when the service's implementation slot is empty, which is the silent trap. */
  serviceImplementation: string | null;
  requirements: RequirementsJson | null;
}

const grt = (wei: bigint) =>
  `${Number(formatUnits(wei, 18)).toLocaleString('en-GB', { maximumFractionDigits: 2 })} GRT`;

const toWei = (whole: number) => BigInt(Math.round(whole)) * 10n ** 18n;

/**
 * Turn the reads into an ordered checklist.
 *
 * Pure, so the whole thing is testable without a chain, and so the wording can be argued over
 * without anybody having to reproduce an on-chain state to see it.
 */
export function preflight(i: PreflightInput): PreflightStep[] {
  const steps: PreflightStep[] = [];
  const min = i.requirements ? toWei(i.requirements.minTokensGrt) : null;

  // 1. The silent trap, checked first because everything after it is meaningless if it fires.
  steps.push(
    i.serviceImplementation === null
      ? {
          key: 'proxy',
          title: 'The service address is not a proxy',
          status: 'blocked',
          detail:
            'Its EIP-1967 implementation slot is empty, so this is either an implementation ' +
            'contract or not an upgradeable proxy at all, and calling one does not revert. If it ' +
            'was never initialised its views return zero forever. If it was initialised, and one ' +
            'of these is, they return stale values that look entirely plausible: the stray ' +
            'RPCDataService implementation reports a minimum provision of 10,000 GRT where the ' +
            'live proxy says 555, and agrees with it on everything else. Resolve the address from ' +
            'the Controller before going further.',
        }
      : {
          key: 'proxy',
          title: 'The service address is a proxy',
          status: 'done',
          detail: `Implementation ${i.serviceImplementation}. Calls will reach initialised storage.`,
        }
  );

  // 2. Can they afford it at all? Stake already down counts, so this is not just a wallet balance.
  const total = i.grtBalance + i.stake;
  if (min === null) {
    steps.push({
      key: 'funds',
      title: 'Minimum provision',
      status: 'unknown',
      detail: 'The service did not answer its own requirements, so there is nothing to compare to.',
    });
  } else if (min === 0n) {
    steps.push({
      key: 'funds',
      title: 'No minimum provision',
      status: 'done',
      detail:
        'This service sets no token floor. That is worth reading twice: a floor of zero may be a ' +
        'deliberate choice or a parameter nobody set, and a provision is stake at risk under the ' +
        "service's slashing terms rather than a fee.",
    });
  } else if (total >= min) {
    steps.push({
      key: 'funds',
      title: 'Enough GRT for the minimum provision',
      status: 'done',
      detail: `Needs ${grt(min)}; this address holds ${grt(i.grtBalance)} and has ${grt(i.stake)} staked.`,
    });
  } else {
    steps.push({
      key: 'funds',
      title: 'Not enough GRT yet',
      status: 'blocked',
      detail: `Needs ${grt(min)} and this address has ${grt(total)} between wallet and stake.`,
    });
  }

  // 3. Stake, which is the step people skip because provisioning sounds like it includes it.
  steps.push(
    i.stake > 0n
      ? {
          key: 'stake',
          title: 'Staked',
          status: 'done',
          detail: `${grt(i.stake)} staked, of which ${grt(i.idleStake)} is idle and available to provision.`,
        }
      : {
          key: 'stake',
          title: 'Stake first',
          status: 'todo',
          detail:
            'Approve GRT to HorizonStaking, then stakeTo(you, tokens). Provisioning moves idle ' +
            'stake to a service; it does not stake for you.',
        }
  );

  // 4. The provision itself, and whether the terms actually satisfy the service.
  if (i.provisionTokens === 0n) {
    steps.push({
      key: 'provision',
      title: 'Provision to this service',
      status: i.stake > 0n && i.idleStake > 0n ? 'todo' : 'blocked',
      detail: i.requirements
        ? `provision(you, service, tokens, maxVerifierCut, thawingPeriod) with at least ` +
          `${i.requirements.minTokensGrt.toLocaleString('en-GB')} GRT and a thawing period between ` +
          `${i.requirements.minThawingDays} and ${i.requirements.maxThawingDays} days. The floor is ` +
          `the service's and the ceiling is the protocol's, so neither is negotiable.`
        : 'provision(you, service, tokens, maxVerifierCut, thawingPeriod).',
    });
  } else {
    const thawDays = Number(i.provisionThawingSeconds) / 86_400;
    const belowFloor =
      i.requirements !== null &&
      (i.provisionTokens < toWei(i.requirements.minTokensGrt) ||
        thawDays < i.requirements.minThawingDays);
    steps.push({
      key: 'provision',
      title: belowFloor ? 'Provisioned, below what the service accepts' : 'Provisioned',
      status: belowFloor ? 'blocked' : 'done',
      detail:
        `${grt(i.provisionTokens)} at a ${thawDays}-day thawing period.` +
        (belowFloor && i.requirements
          ? ` The service requires at least ${i.requirements.minTokensGrt.toLocaleString('en-GB')}` +
            ` GRT and ${i.requirements.minThawingDays} days, so register will be refused until this` +
            ` is raised.`
          : ''),
    });
  }

  // 5. Registration, last, because it is the step that fails for reasons set up earlier.
  steps.push(
    i.registered
      ? {
          key: 'register',
          title: 'Registered with the service',
          status: 'done',
          detail:
            'The registry lists this address. Whether the endpoint it advertises answers is a ' +
            'separate question, and the one that actually matters.',
        }
      : {
          key: 'register',
          title: 'Register, then start the service',
          status: i.provisionTokens > 0n ? 'todo' : 'blocked',
          detail:
            'register(you, abi.encode(endpoint, geoHash, paymentsDestination)), then startService ' +
            'for whatever the service is scoped to. The collector checks your provision is ' +
            'non-zero before paying anybody, so registering without one leaves you unpayable.',
        }
  );

  return steps;
}

/**
 * The one-line answer, for somebody who will not read five rows.
 *
 * **Reads the checklist in order and reports the first step that is not done**, rather than hunting
 * for the first blocker anywhere in it. The steps are a sequence, so a later one is routinely
 * blocked *by* an earlier one that is merely outstanding: an address holding GRT and no stake has a
 * blocked provision step, and telling that person "blocked: provision to this service" points them
 * at the wrong thing entirely. The next move is to stake. Leading with a downstream blocker is the
 * same species of misdirection every trap in this module exists to spare people.
 */
export function preflightVerdict(steps: PreflightStep[]): string {
  const next = steps.find((s) => s.status !== 'done');
  if (!next) return 'Everything on chain is in place.';
  if (next.status === 'unknown') return `Could not check: ${next.title.toLowerCase()}.`;
  const lead = next.status === 'blocked' ? 'Blocked' : 'Next';
  return `${lead}: ${next.title.toLowerCase()}.`;
}

/** What comes off the chain, as against what the caller supplies from elsewhere. */
export type PreflightReads = Omit<PreflightInput, 'requirements' | 'registered'>;

/** Every chain read the checklist needs, in one round. */
export async function readPreflight(
  client: PublicClient,
  address: `0x${string}`,
  service: `0x${string}`
): Promise<PreflightReads> {
  const [balance, stake, idle, provision, implSlot] = await Promise.all([
    client.readContract({
      address: GRT_TOKEN,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    }),
    client.readContract({
      address: HORIZON_STAKING,
      abi: STAKING_ABI,
      functionName: 'getStake',
      args: [address],
    }),
    client.readContract({
      address: HORIZON_STAKING,
      abi: STAKING_ABI,
      functionName: 'getIdleStake',
      args: [address],
    }),
    client.readContract({
      address: HORIZON_STAKING,
      abi: STAKING_ABI,
      functionName: 'getProvision',
      args: [address, service],
    }),
    client.getStorageAt({ address: service, slot: EIP1967_IMPLEMENTATION_SLOT }),
  ]);

  return {
    grtBalance: balance,
    stake,
    idleStake: idle,
    provisionTokens: provision.tokens,
    provisionThawingSeconds: provision.thawingPeriod,
    serviceImplementation: implementationFromSlot(implSlot),
  };
}

/**
 * The last 20 bytes of the slot, or `null` when it holds nothing.
 *
 * Separated out and exported because it is the whole silent-trap detector, and a detector that
 * cannot be tested without a chain is a detector nobody checks.
 */
export function implementationFromSlot(slot: string | undefined): string | null {
  if (!slot || !/^0x[0-9a-fA-F]{64}$/.test(slot)) return null;
  const addr = `0x${slot.slice(26)}`.toLowerCase();
  return addr === '0x0000000000000000000000000000000000000000' ? null : addr;
}
