import { describe, it, expect } from 'vitest';
import {
  implementationFromSlot,
  preflight,
  preflightVerdict,
  type PreflightInput,
} from '../operator-preflight';
import type { RequirementsJson } from '../operator-requirements';

const GRT = (n: number) => BigInt(n) * 10n ** 18n;
const DAYS = (n: number) => BigInt(n * 86_400);

/** Dispatch, read off Arbitrum One on 2026-08-30. */
const DISPATCH: RequirementsJson = {
  minTokensGrt: 555,
  maxTokensGrt: null,
  minThawingDays: 14,
  maxThawingDays: 28,
  minVerifierCutPpm: 0,
  maxVerifierCutPpm: 1_000_000,
  noMinimum: false,
  summary: '555 GRT, thawing period 14 to 28 days.',
};

const base = (over: Partial<PreflightInput> = {}): PreflightInput => ({
  grtBalance: 0n,
  stake: 0n,
  idleStake: 0n,
  provisionTokens: 0n,
  provisionThawingSeconds: 0n,
  registered: false,
  serviceImplementation: '0x3527a12af6256634df6aa9cc2896ed9588e12de3',
  requirements: DISPATCH,
  ...over,
});

const step = (input: PreflightInput, key: string) => preflight(input).find((s) => s.key === key)!;

describe('implementationFromSlot', () => {
  /** The real slot value on the Dispatch proxy, read from Arbitrum One. */
  it('pulls the implementation out of a real slot', () => {
    expect(
      implementationFromSlot(
        '0x0000000000000000000000003527a12af6256634df6aa9cc2896ed9588e12de3'
      )
    ).toBe('0x3527a12af6256634df6aa9cc2896ed9588e12de3');
  });

  /**
   * The silent trap. An implementation's own slot is empty, which is the only reliable way to tell
   * one from a proxy without a chain-specific address list: calling it does not revert, it returns
   * zero forever.
   */
  it('reports an empty slot as not-a-proxy', () => {
    expect(implementationFromSlot(`0x${'00'.repeat(32)}`)).toBeNull();
  });

  it('does not invent an implementation from a missing or malformed read', () => {
    expect(implementationFromSlot(undefined)).toBeNull();
    expect(implementationFromSlot('0x1234')).toBeNull();
    expect(implementationFromSlot('not hex')).toBeNull();
  });
});

describe('preflight', () => {
  it('blocks on the silent trap before anything else', () => {
    const steps = preflight(base({ serviceImplementation: null }));
    expect(steps[0].key).toBe('proxy');
    expect(steps[0].status).toBe('blocked');
    expect(steps[0].detail).toContain('return zero forever');
    expect(preflightVerdict(steps)).toContain('not a proxy');
  });

  it('passes the proxy check on a real proxy', () => {
    expect(step(base(), 'proxy').status).toBe('done');
  });

  /** Stake already down counts towards affording the provision; it is not only a wallet balance. */
  it('counts staked GRT towards the minimum, not just the wallet', () => {
    expect(step(base({ grtBalance: GRT(0), stake: GRT(600) }), 'funds').status).toBe('done');
    expect(step(base({ grtBalance: GRT(600) }), 'funds').status).toBe('done');
    expect(step(base({ grtBalance: GRT(100), stake: GRT(100) }), 'funds').status).toBe('blocked');
  });

  it('tells somebody to stake before provisioning, because provisioning does not stake', () => {
    const s = step(base({ grtBalance: GRT(600) }), 'stake');
    expect(s.status).toBe('todo');
    expect(s.detail).toContain('does not stake for you');
  });

  it('cannot provision without idle stake', () => {
    expect(step(base({ stake: GRT(600), idleStake: 0n }), 'provision').status).toBe('blocked');
    expect(step(base({ stake: GRT(600), idleStake: GRT(600) }), 'provision').status).toBe('todo');
  });

  /**
   * The number that costs the afternoon, stated as the window it actually is. The floor is the
   * service's and the ceiling is the protocol's, and a reader who knows only one of them picks a
   * value the other refuses.
   */
  it('states the thawing window with both ends', () => {
    const d = step(base({ stake: GRT(600), idleStake: GRT(600) }), 'provision').detail;
    expect(d).toContain('555 GRT');
    expect(d).toContain('between 14 and 28 days');
  });

  /**
   * A provision that exists but sits under the service's floor is the worst state to be in, because
   * everything looks done and `register` refuses for a reason that names something else.
   */
  it('catches a provision that is below what the service accepts', () => {
    const s = step(
      base({ stake: GRT(600), provisionTokens: GRT(100), provisionThawingSeconds: DAYS(14) }),
      'provision'
    );
    expect(s.status).toBe('blocked');
    expect(s.title).toContain('below what the service accepts');
    expect(s.detail).toContain('register will be refused');
  });

  it('catches a thawing period below the floor even when the tokens are fine', () => {
    const s = step(
      base({ stake: GRT(600), provisionTokens: GRT(600), provisionThawingSeconds: DAYS(7) }),
      'provision'
    );
    expect(s.status).toBe('blocked');
  });

  /** The real state of 0xb43b2ccc… on Dispatch: 600 GRT at 14 days, registered. */
  it('reads a live, correct provision as done', () => {
    const s = step(
      base({
        stake: GRT(600),
        provisionTokens: GRT(600),
        provisionThawingSeconds: DAYS(14),
        registered: true,
      }),
      'provision'
    );
    expect(s.status).toBe('done');
    expect(s.detail).toContain('600 GRT at a 14-day thawing period');
  });

  /**
   * Being in the registry is not being useful, and the checklist must not imply otherwise. That
   * conflation is the whole reason Dispatch looked healthy for 39 days.
   */
  it('does not let being registered imply anything is answering', () => {
    const s = step(base({ registered: true }), 'register');
    expect(s.status).toBe('done');
    expect(s.detail).toContain('separate question');
  });

  it('cannot register without a provision', () => {
    expect(step(base(), 'register').status).toBe('blocked');
    expect(step(base({ provisionTokens: GRT(600) }), 'register').status).toBe('todo');
  });

  /** A service with no floor is reported, never sold as free. */
  it('flags a zero floor rather than advertising it', () => {
    const free: RequirementsJson = { ...DISPATCH, minTokensGrt: 0, noMinimum: true };
    const s = step(base({ requirements: free }), 'funds');
    expect(s.status).toBe('done');
    expect(s.detail).toContain('parameter nobody set');
    expect(s.detail).toContain('stake at risk');
  });

  /** Unreadable requirements must not read as satisfied. */
  it('says unknown when the service did not answer its own requirements', () => {
    expect(step(base({ requirements: null }), 'funds').status).toBe('unknown');
  });
});

describe('preflightVerdict', () => {
  it('leads with a genuine blocker', () => {
    expect(preflightVerdict(preflight(base({ serviceImplementation: null })))).toContain('Blocked');
    expect(preflightVerdict(preflight(base({ grtBalance: GRT(1) })))).toBe(
      'Blocked: not enough grt yet.'
    );
  });

  /**
   * The regression this fixes. An address holding GRT and no stake has a blocked *provision* step,
   * because provisioning needs idle stake. Reporting that as the headline points somebody at the
   * wrong thing: the next move is to stake, and the provision step is only blocked by the step
   * above it. The verdict reads the sequence in order.
   */
  it('does not lead with a step that is only blocked by an earlier one', () => {
    const v = preflightVerdict(preflight(base({ grtBalance: GRT(600) })));
    expect(v).toBe('Next: stake first.');
  });

  it('says so when everything on chain is already in place', () => {
    const v = preflightVerdict(
      preflight(
        base({
          stake: GRT(600),
          idleStake: GRT(600),
          provisionTokens: GRT(600),
          provisionThawingSeconds: DAYS(14),
          registered: true,
        })
      )
    );
    expect(v).toBe('Everything on chain is in place.');
  });
});
