/**
 * Turning a Horizon revert into a sentence.
 *
 * The four traps in [`becoming-an-operator.md`](../../docs/becoming-an-operator.md) each cost a real
 * afternoon, and every one of them fails in a way that points somewhere else. The provisioning
 * ceiling is the clearest case: exceed it and the transaction is refused by a custom error carrying
 * **two raw numbers and no name**, which reads as an opaque failure until somebody converts them
 * and realises one is their input and the other is the limit. `cast send` prints the selector and
 * the calldata; a wallet prints "execution reverted". Neither says what to do.
 *
 * So this decodes the 63 custom errors these contracts actually throw, and for the ones that matter
 * it says what went wrong and what to change. The signatures are generated from the compiled ABIs
 * rather than transcribed, because a hand-copied selector that is one character out decodes nothing
 * and looks like an unknown error.
 *
 * It is deliberately pure: no chain, no clock, no network. Handed the `data` from a revert, it
 * answers. That makes it usable from a preflight, from an error boundary and from a test.
 */

import { decodeErrorResult, parseAbi, formatUnits } from 'viem';

/**
 * Every custom error these contracts declare, generated from the compiled artefacts in
 * `chain-integration-ds/contracts/out`. Unknown selectors are reported as unknown rather than
 * guessed at, because a confident wrong explanation is worse than none.
 */
export const HORIZON_ERRORS = parseAbi([
  'error DataServicePausableNotPauseGuardian(address)',
  'error DataServicePausablePauseGuardianNoChange(address,bool)',
  'error GraphPaymentsInvalidCut(uint256)',
  'error GraphPaymentsInvalidProtocolPaymentCut(uint256)',
  'error HorizonStakingCallerIsServiceProvider()',
  'error HorizonStakingInsufficientDelegationTokens(uint256,uint256)',
  'error HorizonStakingInsufficientIdleStake(uint256,uint256)',
  'error HorizonStakingInsufficientShares(uint256,uint256)',
  'error HorizonStakingInsufficientTokens(uint256,uint256)',
  'error HorizonStakingInvalidDelegationFeeCut(uint256)',
  'error HorizonStakingInvalidDelegationPool(address,address)',
  'error HorizonStakingInvalidDelegationPoolState(address,address)',
  'error HorizonStakingInvalidMaxVerifierCut(uint32)',
  'error HorizonStakingInvalidProvision(address,address)',
  'error HorizonStakingInvalidServiceProviderZeroAddress()',
  'error HorizonStakingInvalidThawRequestType()',
  'error HorizonStakingInvalidThawingPeriod(uint64,uint64)',
  'error HorizonStakingInvalidVerifierZeroAddress()',
  'error HorizonStakingInvalidZeroShares()',
  'error HorizonStakingInvalidZeroTokens()',
  'error HorizonStakingNoTokensToSlash()',
  'error HorizonStakingNotAuthorized(address,address,address)',
  'error HorizonStakingNothingThawing()',
  'error HorizonStakingNothingToWithdraw()',
  'error HorizonStakingProvisionAlreadyExists()',
  'error HorizonStakingSlippageProtection(uint256,uint256)',
  'error HorizonStakingTooManyThawRequests()',
  'error HorizonStakingTooManyTokens(uint256,uint256)',
  'error HorizonStakingVerifierNotAllowed(address)',
  'error PaymentsEscrowInconsistentCollection(uint256,uint256,uint256)',
  'error PaymentsEscrowInsufficientBalance(uint256,uint256)',
  'error PaymentsEscrowInvalidZeroTokens()',
  'error PaymentsEscrowIsPaused()',
  'error PaymentsEscrowNotThawing()',
  'error PaymentsEscrowStillThawing(uint256,uint256)',
  'error PaymentsEscrowThawingPeriodTooLong(uint256,uint256)',
  'error ProvisionManagerInvalidRange(uint256,uint256)',
  'error ProvisionManagerInvalidValue(bytes,uint256,uint256,uint256)',
  'error ProvisionManagerNotAuthorized(address,address)',
  'error ProvisionManagerProvisionNotFound(address)',
  'error RecurringCollectorAgreementAddressNotSet()',
  'error RecurringCollectorAgreementDeadlineElapsed(uint256,uint64)',
  'error RecurringCollectorAgreementEndsBeforeDeadline(uint64,uint64)',
  'error RecurringCollectorAgreementIdZero()',
  'error RecurringCollectorAgreementIncorrectState(bytes16,uint8)',
  'error RecurringCollectorAgreementInvalidCollectionWindow(uint32,uint32,uint32)',
  'error RecurringCollectorAgreementInvalidDuration(uint32,uint256)',
  'error RecurringCollectorAgreementNotCollectable(bytes16,uint8)',
  'error RecurringCollectorCollectionNotEligible(bytes16,address)',
  'error RecurringCollectorCollectionTooSoon(bytes16,uint32,uint32)',
  'error RecurringCollectorDataServiceNotAuthorized(bytes16,address)',
  'error RecurringCollectorExcessiveSlippage(uint256,uint256,uint256)',
  'error RecurringCollectorInsufficientCallbackGas()',
  'error RecurringCollectorInvalidCollectData(bytes)',
  'error RecurringCollectorInvalidOfferType(uint8)',
  'error RecurringCollectorInvalidSigner()',
  'error RecurringCollectorInvalidUpdateNonce(bytes16,uint32,uint32)',
  'error RecurringCollectorNotGovernor(address)',
  'error RecurringCollectorNotPauseGuardian(address)',
  'error RecurringCollectorOfferCancelled(address,bytes32)',
  'error RecurringCollectorPauseGuardianNoChange(address,bool)',
  'error RecurringCollectorPayerDoesNotSupportInterface(address,bytes4)',
  'error RecurringCollectorUnauthorizedCaller(address,address)'
]);

/** How long, in a unit a human budgets in. */
function days(seconds: bigint): string {
  const d = Number(seconds) / 86_400;
  return Number.isInteger(d) ? `${d} days` : `${d.toFixed(2)} days`;
}

/** GRT, which is 18 decimals, printed without a wall of zeroes. */
function grt(wei: bigint): string {
  const n = Number(formatUnits(wei, 18));
  return `${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })} GRT`;
}

export interface DecodedRevert {
  selector: string;
  /** `null` when the selector is not one of ours. */
  name: string | null;
  args: readonly unknown[];
  /** What went wrong, and where it is knowable, what to change. */
  plain: string;
  /**
   * Set when this is one of the documented traps, so a caller can link to the write-up rather than
   * make the reader search for it.
   */
  trap?: 'thawing-period' | 'provision-range' | 'authorize-own-key' | 'no-provision' | 'not-you';
}

type Explainer = (args: readonly unknown[]) => Omit<DecodedRevert, 'selector' | 'name' | 'args'>;

/**
 * Hand-written for the errors an operator actually meets. Everything else falls back to the name
 * and its arguments, which is still better than a selector, and pretending to explain an error
 * nobody here has hit would be inventing advice.
 */
const EXPLAIN: Record<string, Explainer> = {
  HorizonStakingInvalidThawingPeriod: ([got, max]) => ({
    plain:
      `The thawing period you passed is ${days(got as bigint)}, and the protocol caps it at ` +
      `${days(max as bigint)}. Pass 14 days: it is comfortably inside and nothing depends on it ` +
      `being larger.`,
    trap: 'thawing-period',
  }),
  ProvisionManagerInvalidValue: ([name, value, min, max]) => {
    const what = typeof name === 'string' ? name : 'a provision parameter';
    return {
      plain:
        `The service refused ${what}: you passed ${value}, and it accepts between ${min} and ` +
        `${max}. This is the data service's own range, not the protocol's, so it differs per ` +
        `service.`,
      trap: 'provision-range',
    };
  },
  ProvisionManagerProvisionNotFound: ([who]) => ({
    plain:
      `No provision to this data service exists for ${who}. Stake first, then provision to the ` +
      `service's address, then register. The collector checks the provision is non-zero before ` +
      `paying anybody, which is the guard against a rogue data service draining somebody's escrow.`,
    trap: 'no-provision',
  }),
  ProvisionManagerNotAuthorized: ([provider, caller]) => ({
    plain:
      `${caller} is not authorised to act for ${provider} on this service. Either call as the ` +
      `service provider, or have them authorise you as an operator first.`,
    trap: 'not-you',
  }),
  HorizonStakingNotAuthorized: ([provider, verifier, caller]) => ({
    plain:
      `${caller} may not provision for ${provider} to ${verifier}. You can only provision your own ` +
      `stake unless the provider has authorised you as an operator.`,
    trap: 'not-you',
  }),
  RecurringCollectorInvalidSigner: () => ({
    plain:
      `The signature did not recover to an authorised signer, and the usual cause is not the ` +
      `signature. A payer must authorise their own key before any agreement they sign will verify: ` +
      `the contract requires authorizations[signer].authorizer == payer and does not special-case ` +
      `signer being the payer. Run tattler authorize-proof and send the transaction it prints.`,
    trap: 'authorize-own-key',
  }),
  HorizonStakingInsufficientIdleStake: ([want, have]) => ({
    plain:
      `You asked to provision ${grt(want as bigint)} and only ${grt(have as bigint)} is idle. ` +
      `Stake more, or free some by thawing an existing provision.`,
  }),
  HorizonStakingInsufficientTokens: ([got, min]) => ({
    plain: `${grt(got as bigint)} is below the minimum of ${grt(min as bigint)}.`,
  }),
  HorizonStakingTooManyTokens: ([got, max]) => ({
    plain: `${grt(got as bigint)} is above the maximum of ${grt(max as bigint)}.`,
  }),
  HorizonStakingProvisionAlreadyExists: () => ({
    plain:
      `A provision to this service already exists. Add to it with addToProvision rather than ` +
      `creating a second one.`,
  }),
  HorizonStakingInvalidMaxVerifierCut: ([cut]) => ({
    plain: `A verifier cut of ${cut} is out of range. It is parts per million, so 500000 is 50%.`,
  }),
  HorizonStakingVerifierNotAllowed: ([verifier]) => ({
    plain:
      `${verifier} is not an allowed verifier. Check you are provisioning to the data service's ` +
      `proxy address and not to an implementation. An implementation does not revert when called: ` +
      `it returns zero if it was never initialised, and stale but plausible values if it was.`,
  }),
  HorizonStakingTooManyThawRequests: () => ({
    plain:
      `You already have the maximum number of thaw requests outstanding (1,000). Withdraw some ` +
      `before starting another.`,
  }),
  HorizonStakingInvalidZeroTokens: () => ({ plain: `The token amount was zero.` }),
  PaymentsEscrowInsufficientBalance: ([have, want]) => ({
    plain:
      `The escrow holds ${grt(have as bigint)} and this collection needs ${grt(want as bigint)}. ` +
      `The payer must deposit more before it can be collected.`,
  }),
  DataServicePausableNotPauseGuardian: ([who]) => ({
    plain: `${who} is not a pause guardian on this service.`,
  }),
};

/**
 * Decode the `data` from a reverted call.
 *
 * Accepts the bare hex, so a caller can pass whatever their client hands them without unwrapping
 * a provider-specific error shape first.
 */
export function decodeHorizonRevert(data: string | undefined | null): DecodedRevert {
  // Lower-cased before anything looks at it. viem matches the selector against its own lower-case
  // computation, so a caller passing the checksum-cased hex their client handed them would get
  // "unknown error" for an error that is right here in the table.
  const hex = (data ?? '').trim().toLowerCase();
  if (!/^0x[0-9a-fA-F]*$/.test(hex) || hex.length < 10) {
    return {
      selector: hex,
      name: null,
      args: [],
      plain:
        hex === '0x' || hex === ''
          ? 'The call reverted without a reason. On a Horizon contract that usually means a ' +
            'require with no message, or a call to an address with no code at all.'
          : 'That is not revert data.',
    };
  }
  const selector = hex.slice(0, 10);
  try {
    const { errorName, args } = decodeErrorResult({
      abi: HORIZON_ERRORS,
      data: hex as `0x${string}`,
    });
    const a = (args ?? []) as readonly unknown[];
    const explain = EXPLAIN[errorName];
    if (explain) return { selector, name: errorName, args: a, ...explain(a) };
    return {
      selector,
      name: errorName,
      args: a,
      plain: a.length ? `${errorName}, with ${a.join(', ')}.` : `${errorName}.`,
    };
  } catch {
    return {
      selector,
      name: null,
      args: [],
      plain:
        `Reverted with ${selector}, which is not one of the 63 errors these contracts declare. ` +
        `It may come from a contract further down the call, or from a version newer than this ` +
        `table.`,
    };
  }
}

/**
 * Pull the revert out of whatever a wallet library threw, and explain it.
 *
 * viem buries the data on a cause several links down and puts a readable-ish summary on
 * `message`; wagmi wraps that again. Every call site in this app was slicing `e.message` to 300
 * characters, which reliably keeps the words "execution reverted" and discards the only part that
 * says why.
 *
 * Falls back to the original message rather than to silence: an error that is not a Horizon revert
 * is still an error the user needs to read.
 */
export function explainWriteError(err: unknown): string {
  const hex = findRevertData(err);
  if (hex) {
    const d = decodeHorizonRevert(hex);
    if (d.name) return d.plain;
  }
  if (err instanceof Error) {
    // viem's own one-line summary, where it has one, beats the full stack-shaped message.
    const short = (err as Error & { shortMessage?: string }).shortMessage;
    return short || err.message;
  }
  return String(err);
}

const REVERT_HEX = /0x[0-9a-fA-F]{8}(?:[0-9a-fA-F]{64})*/;

/** Walk the cause chain for revert data, then fall back to reading it out of the message. */
function findRevertData(err: unknown, depth = 0): string | null {
  if (!err || typeof err !== 'object' || depth > 8) return null;
  const e = err as { data?: unknown; raw?: unknown; cause?: unknown; message?: unknown };
  for (const candidate of [e.data, e.raw]) {
    if (typeof candidate === 'string' && candidate.startsWith('0x') && candidate.length >= 10) {
      return candidate;
    }
  }
  const nested = findRevertData(e.cause, depth + 1);
  if (nested) return nested;
  if (typeof e.message === 'string') {
    const m = e.message.match(REVERT_HEX);
    // A bare address matches the shape too, so require enough length to be a selector plus a word.
    if (m && (m[0].length === 10 || (m[0].length - 10) % 64 === 0) && m[0].length !== 42) {
      return m[0];
    }
  }
  return null;
}
