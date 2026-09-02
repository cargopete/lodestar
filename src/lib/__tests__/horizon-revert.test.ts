import { describe, it, expect } from 'vitest';
import { encodeErrorResult, parseEther } from 'viem';
import { decodeHorizonRevert, explainWriteError, HORIZON_ERRORS } from '../horizon-revert';

const revert = (errorName: string, args: readonly unknown[] = []) =>
  encodeErrorResult({
    abi: HORIZON_ERRORS,
    // viem narrows this against the ABI; the tests deliberately drive it by name.
    errorName: errorName as never,
    args: args as never,
  });

describe('decodeHorizonRevert', () => {
  /**
   * The revert this whole module exists for. Our own operator write-up describes it as carrying
   * "two raw numbers and no name", which is what a wallet or `cast send` shows you, and the numbers
   * are seconds. Nobody budgets a thawing period in seconds.
   */
  it('turns the thawing-period cap into days and a recommendation', () => {
    const d = decodeHorizonRevert(
      revert('HorizonStakingInvalidThawingPeriod', [2_592_000n, 2_419_200n])
    );
    expect(d.name).toBe('HorizonStakingInvalidThawingPeriod');
    expect(d.trap).toBe('thawing-period');
    expect(d.plain).toContain('30 days');
    expect(d.plain).toContain('28 days');
    expect(d.plain).toContain('14 days');
  });

  /**
   * The Recurring Collector trap, where the error names the signature and the signature is fine.
   * A payer must authorise their own key first, and the explanation has to say so, because
   * "invalid signer" sends people to re-check their EIP-712 domain for a day.
   */
  it('explains that an invalid signer usually means an unauthorised own key', () => {
    const d = decodeHorizonRevert(revert('RecurringCollectorInvalidSigner'));
    expect(d.trap).toBe('authorize-own-key');
    expect(d.plain).toContain('authorise their own key');
    expect(d.plain).toContain('tattler authorize-proof');
  });

  /** Decoded against a revert taken from the live chain, not a fixture I wrote to match. */
  it('decodes a real revert from Arbitrum One', () => {
    // `provision(...)` on HorizonStaking at 0x00669A4C…, called from address(0) for 0x…01.
    const live =
      '0xc76b97b0' +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      '0000000000000000000000007101d5c1a5c89c3647f5118da118e56c023ba0b9' +
      '0000000000000000000000000000000000000000000000000000000000000000';
    const d = decodeHorizonRevert(live);
    expect(d.name).toBe('HorizonStakingNotAuthorized');
    expect(d.trap).toBe('not-you');
    expect(d.plain.toLowerCase()).toContain('0x7101d5c1a5c89c3647f5118da118e56c023ba0b9');
  });

  it('formats GRT amounts rather than printing wei', () => {
    const d = decodeHorizonRevert(
      revert('HorizonStakingInsufficientIdleStake', [parseEther('100000'), parseEther('62.5')])
    );
    expect(d.plain).toContain('100,000 GRT');
    expect(d.plain).toContain('62.5 GRT');
    expect(d.plain).not.toContain('000000000000000000');
  });

  it('carries the service-specific range for a provision the service refused', () => {
    const d = decodeHorizonRevert(
      revert('ProvisionManagerInvalidValue', ['0x74686177696e67', 100n, 1n, 50n])
    );
    expect(d.trap).toBe('provision-range');
    expect(d.plain).toContain('100');
    expect(d.plain).toContain('1');
    expect(d.plain).toContain('50');
  });

  /**
   * The implementation-versus-proxy trap has no error of its own, because calling an
   * implementation does not revert. Where it does surface, as a disallowed verifier, the
   * explanation has to name it, since the reader is otherwise looking at a permissions problem.
   */
  it('names both halves of the implementation trap, not just the zeroes', () => {
    const d = decodeHorizonRevert(
      revert('HorizonStakingVerifierNotAllowed', ['0x0000000000000000000000000000000000000042'])
    );
    expect(d.plain).toContain('implementation');
    // Both halves. The usual telling is "uninitialised storage, so views return zero", which is the
    // benign one: a zero is obviously wrong and gets caught. An initialised implementation returns
    // stale values that look right, and the stray RPCDataService does exactly that, reporting a
    // 10,000 GRT minimum provision where the live proxy says 555.
    expect(d.plain).toContain('zero if it was never initialised');
    expect(d.plain).toContain('stale but plausible');
  });

  it('still names an error it has no hand-written explanation for', () => {
    const d = decodeHorizonRevert(revert('HorizonStakingNothingThawing'));
    expect(d.name).toBe('HorizonStakingNothingThawing');
    expect(d.plain).toContain('HorizonStakingNothingThawing');
    expect(d.trap).toBeUndefined();
  });

  /**
   * An unknown selector must read as unknown. A decoder that guessed would send somebody to fix
   * the wrong thing with full confidence, which is worse than telling them nothing.
   */
  it('reports an unknown selector as unknown rather than guessing', () => {
    const d = decodeHorizonRevert(`0xdeadbeef${'00'.repeat(32)}`);
    expect(d.name).toBeNull();
    expect(d.selector).toBe('0xdeadbeef');
    expect(d.plain).toContain('not one of the 63 errors');
  });

  /** An empty revert is its own diagnosis, and a common one: a call to an address with no code. */
  it('separates an empty revert from a malformed one', () => {
    expect(decodeHorizonRevert('0x').plain).toContain('without a reason');
    expect(decodeHorizonRevert('').plain).toContain('without a reason');
    expect(decodeHorizonRevert('not hex').plain).toBe('That is not revert data.');
    expect(decodeHorizonRevert(undefined).plain).toContain('without a reason');
  });

  it('is case-insensitive about the selector', () => {
    const live = `0xC76B97B0${'00'.repeat(32)}${'00'.repeat(32)}${'00'.repeat(32)}`;
    expect(decodeHorizonRevert(live).name).toBe('HorizonStakingNotAuthorized');
  });

  it('declares every error exactly once', () => {
    const names = HORIZON_ERRORS.map((e) => `${e.name}(${e.inputs.map((i) => i.type).join(',')})`);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(63);
  });
});

describe('explainWriteError', () => {
  /** viem buries the data several causes down, which is why reading `message` misses it. */
  it('finds revert data on a nested cause', () => {
    const err = Object.assign(new Error('execution reverted'), {
      cause: { cause: { data: revert('HorizonStakingInvalidThawingPeriod', [2_592_000n, 2_419_200n]) } },
    });
    expect(explainWriteError(err)).toContain('caps it at 28 days');
  });

  it('reads it out of the message when nothing carries it structurally', () => {
    const err = new Error(
      `The contract function reverted. data: ${revert('RecurringCollectorInvalidSigner')}`
    );
    expect(explainWriteError(err)).toContain('authorise their own key');
  });

  /**
   * An address in a message has the same shape as a short revert. Mistaking one for the other
   * would produce a confident explanation of an error that never happened.
   */
  it('does not mistake an address in the message for revert data', () => {
    const err = new Error('user rejected at 0x7101d5c1a5c89c3647f5118da118e56c023ba0b9');
    expect(explainWriteError(err)).toBe('user rejected at 0x7101d5c1a5c89c3647f5118da118e56c023ba0b9');
  });

  it('prefers a short message to a stack-shaped one when there is no revert', () => {
    const err = Object.assign(new Error('long\nmultiline\nrubbish'), {
      shortMessage: 'User rejected the request.',
    });
    expect(explainWriteError(err)).toBe('User rejected the request.');
  });

  it('survives something that is not an Error at all', () => {
    expect(explainWriteError('boom')).toBe('boom');
    expect(explainWriteError(null)).toBe('null');
  });
});

/**
 * The rest of the hand-written explainers.
 *
 * Each one exists because the raw error is actively misleading rather than merely terse, so the
 * assertions are about the sentence saying the thing the selector does not: which of the two
 * numbers is yours, which address is the one you are not, and what to do next. A wrong-but-fluent
 * explanation is worse than a selector, which is why the fallback branch stays honest too.
 */
describe('decodeHorizonRevert — the remaining explained errors', () => {
  it('says a missing provision is a missing provision, and why the check exists', () => {
    const d = decodeHorizonRevert(
      revert('ProvisionManagerProvisionNotFound', ['0x1111111111111111111111111111111111111111'])
    );
    expect(d.trap).toBe('no-provision');
    expect(d.plain).toContain('0x1111111111111111111111111111111111111111');
    expect(d.plain).toMatch(/stake first/i);
  });

  it('names caller and provider separately when the service refuses the caller', () => {
    // Both are addresses and the order is the whole meaning: getting it backwards sends someone
    // to authorise the wrong side.
    const provider = '0x1111111111111111111111111111111111111111';
    const caller = '0x2222222222222222222222222222222222222222';
    const d = decodeHorizonRevert(revert('ProvisionManagerNotAuthorized', [provider, caller]));

    expect(d.trap).toBe('not-you');
    expect(d.plain.indexOf(caller)).toBeLessThan(d.plain.indexOf(provider));
  });

  it('explains an insufficient minimum in GRT', () => {
    const d = decodeHorizonRevert(
      revert('HorizonStakingInsufficientTokens', [parseEther('50'), parseEther('100000')])
    );
    expect(d.plain).toContain('50 GRT');
    expect(d.plain).toContain('100,000 GRT');
    expect(d.trap).toBeUndefined();
  });

  it('explains exceeding a maximum in GRT', () => {
    const d = decodeHorizonRevert(
      revert('HorizonStakingTooManyTokens', [parseEther('200'), parseEther('100')])
    );
    expect(d.plain).toContain('200 GRT');
    expect(d.plain).toContain('100 GRT');
  });

  it('points an already-existing provision at addToProvision', () => {
    const d = decodeHorizonRevert(revert('HorizonStakingProvisionAlreadyExists'));
    expect(d.plain).toContain('addToProvision');
    expect(d.args).toEqual([]);
  });

  it('says a verifier cut is parts per million, because the number looks absurd otherwise', () => {
    // 5000000 reads as "five million percent" until somebody says the unit out loud.
    const d = decodeHorizonRevert(revert('HorizonStakingInvalidMaxVerifierCut', [5_000_000]));
    expect(d.plain).toContain('5000000');
    expect(d.plain).toMatch(/parts per million/i);
    expect(d.plain).toContain('500000 is 50%');
  });

  it('gives the thaw-request ceiling as a number rather than "too many"', () => {
    const d = decodeHorizonRevert(revert('HorizonStakingTooManyThawRequests'));
    expect(d.plain).toContain('1,000');
  });

  it('states the zero-token case plainly', () => {
    const d = decodeHorizonRevert(revert('HorizonStakingInvalidZeroTokens'));
    expect(d.name).toBe('HorizonStakingInvalidZeroTokens');
    expect(d.plain).toMatch(/zero/i);
  });

  it('says whose problem an empty escrow is', () => {
    // The collector cannot fix this; the payer has to deposit. Naming the wrong party here costs
    // an afternoon of an indexer checking their own configuration.
    const d = decodeHorizonRevert(
      revert('PaymentsEscrowInsufficientBalance', [parseEther('1.5'), parseEther('10')])
    );
    expect(d.plain).toContain('1.5 GRT');
    expect(d.plain).toContain('10 GRT');
    expect(d.plain).toMatch(/payer must deposit/i);
  });

  it('names the address that is not a pause guardian', () => {
    const d = decodeHorizonRevert(
      revert('DataServicePausableNotPauseGuardian', ['0x3333333333333333333333333333333333333333'])
    );
    expect(d.plain).toContain('0x3333333333333333333333333333333333333333');
  });

  it('rounds a thawing period that is not a whole number of days', () => {
    // 2.5 days as seconds. `${d} days` on a float would print 2.5 here but 2.4999999 elsewhere.
    const d = decodeHorizonRevert(
      revert('HorizonStakingInvalidThawingPeriod', [216_000n, 2_419_200n])
    );
    expect(d.plain).toContain('2.50 days');
    expect(d.plain).toContain('28 days');
  });

  it('falls back to the parameter name being absent from ProvisionManagerInvalidValue', () => {
    // The first field is `bytes`, and viem hands back a hex string either way — but the explainer
    // guards for a non-string, and that branch must still produce a usable sentence.
    const d = decodeHorizonRevert(
      revert('ProvisionManagerInvalidValue', ['0x', 7n, 1n, 5n])
    );
    expect(d.trap).toBe('provision-range');
    expect(d.plain).toContain('7');
    expect(d.plain).toContain('between 1 and 5');
  });
});
