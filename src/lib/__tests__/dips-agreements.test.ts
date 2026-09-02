/**
 * DIPS agreement lifecycle folding.
 *
 * Every table this reads is empty on Arbitrum One, so these fixtures are the only exercise this
 * code will get before the day it matters. That makes the state machine worth pinning hard: a
 * routine collection must not un-cancel an agreement, a later event omitting the payer must not
 * erase one an earlier event supplied, and "no agreements have ever existed" must stay
 * distinguishable from "this indexer has none".
 */
import { describe, it, expect } from 'vitest';
import { buildAgreements, forIndexer, type StageRows } from '../dips-agreements';

const GRT = 10n ** 18n;
const wei = (n: number) => ((BigInt(Math.round(n * 1000)) * GRT) / 1000n).toString();

const ID = '0x11111111111111111111111111111111';
const ID2 = '0x22222222222222222222222222222222';
const INDEXER = '0xaaaa111122223333444455556666777788889999';
const OTHER = '0xbbbb111122223333444455556666777788889999';
const PAYER = '0xcccc111122223333444455556666777788889999';
const DATA_SERVICE = '0xdddd111122223333444455556666777788889999';

function row(over: Record<string, unknown> = {}) {
  return {
    block_number: 500_000_000,
    block_timestamp: 1_756_000_000,
    tx_hash: '0xtx',
    agreementId: ID,
    ...over,
  };
}

describe('buildAgreements', () => {
  it('reports emptiness explicitly when nothing has ever happened', () => {
    // The state of Arbitrum One today. `empty` says it, rather than leaving a caller to infer it.
    const s = buildAgreements({});
    expect(s.empty).toBe(true);
    expect(s.agreements).toEqual([]);
    expect(s.events).toEqual([]);
    expect(s.totalCollectedGrt).toBe(0);
  });

  it('walks an agreement from offer to active', () => {
    const rows: StageRows = {
      offerStored: [row({ block_number: 1, payer: PAYER })],
      accepted: [
        row({
          block_number: 2,
          payer: PAYER,
          serviceProvider: INDEXER,
          dataService: DATA_SERVICE,
          endsAt: 1_800_000_000,
          maxInitialTokens_dec: wei(100),
          maxOngoingTokensPerSecond_dec: wei(0.5),
        }),
      ],
      added: [row({ block_number: 3, provider: INDEXER })],
    };

    const s = buildAgreements(rows);
    expect(s.agreements).toHaveLength(1);

    const a = s.agreements[0];
    expect(a.status).toBe('active');
    expect(a.payer).toBe(PAYER);
    expect(a.serviceProvider).toBe(INDEXER);
    expect(a.dataService).toBe(DATA_SERVICE);
    expect(a.endsAt).toBe(1_800_000_000);
    expect(a.maxInitialTokens).toBeCloseTo(100, 9);
    expect(a.maxOngoingTokensPerSecond).toBeCloseTo(0.5, 9);
    expect(s.counts.active).toBe(1);
    expect(s.empty).toBe(false);
  });

  it('does not let a collection un-cancel an agreement', () => {
    // Collections recur and say nothing about whether the agreement later ended. Ordering purely
    // by block would let a late-arriving collection resurrect a cancelled agreement.
    const rows: StageRows = {
      accepted: [row({ block_number: 1, serviceProvider: INDEXER })],
      canceled: [row({ block_number: 2, canceledBy: 1 })],
      collected: [row({ block_number: 3, tokens_dec: wei(5), dataServiceCut_dec: wei(1) })],
    };

    const a = buildAgreements(rows).agreements[0];
    expect(a.status).toBe('cancelled');
    expect(a.canceledBy).toBe(1);
    // The collection still counts toward the money, it just does not change the state.
    expect(a.collectedGrt).toBeCloseTo(5, 9);
  });

  it('sums collections and the data-service cut across events', () => {
    const rows: StageRows = {
      accepted: [row({ block_number: 1, serviceProvider: INDEXER })],
      collected: [
        row({ block_number: 2, tokens_dec: wei(10), dataServiceCut_dec: wei(1) }),
        row({ block_number: 3, tokens_dec: wei(2.5), dataServiceCut_dec: wei(0.25) }),
      ],
    };

    const s = buildAgreements(rows);
    const a = s.agreements[0];
    expect(a.collections).toBe(2);
    expect(a.collectedGrt).toBeCloseTo(12.5, 9);
    expect(a.dataServiceCutGrt).toBeCloseTo(1.25, 9);
    expect(s.totalCollectedGrt).toBeCloseTo(12.5, 9);
  });

  it('keeps the rejection reason, which is the answer an indexer actually wants', () => {
    const rows: StageRows = {
      accepted: [row({ block_number: 1, serviceProvider: INDEXER })],
      rejected: [row({ block_number: 2, reason: 3 })],
    };
    const a = buildAgreements(rows).agreements[0];

    expect(a.status).toBe('rejected');
    // Reported as the raw enum: the meanings belong to the contract, not to this dashboard.
    expect(a.rejectedReason).toBe(3);
  });

  it('does not erase an identity a later event simply omits', () => {
    // `agreement_removed` carries only the id. Overwriting on every event would blank the payer.
    const rows: StageRows = {
      accepted: [row({ block_number: 1, payer: PAYER, serviceProvider: INDEXER })],
      removed: [row({ block_number: 2 })],
    };
    const a = buildAgreements(rows).agreements[0];

    expect(a.status).toBe('removed');
    expect(a.payer).toBe(PAYER);
    expect(a.serviceProvider).toBe(INDEXER);
  });

  it('lower-cases addresses so a checksummed one still matches', () => {
    const rows: StageRows = {
      accepted: [row({ serviceProvider: INDEXER.toUpperCase().replace('0X', '0x') })],
    };
    expect(buildAgreements(rows).agreements[0].serviceProvider).toBe(INDEXER);
  });

  it('reads the manager\'s `provider` as the service provider', () => {
    // The two contracts name the same party differently; the view must not split them.
    const rows: StageRows = { added: [row({ provider: INDEXER })] };
    expect(buildAgreements(rows).agreements[0].serviceProvider).toBe(INDEXER);
  });

  it('treats an absent token figure as zero rather than NaN', () => {
    const rows: StageRows = { collected: [row({ tokens_dec: null, dataServiceCut_dec: undefined })] };
    const a = buildAgreements(rows).agreements[0];
    expect(a.collectedGrt).toBe(0);
    expect(a.dataServiceCutGrt).toBe(0);
  });

  it('falls back to the raw column when the decimal companion is missing', () => {
    const rows: StageRows = { collected: [row({ tokens: wei(3) })] };
    expect(buildAgreements(rows).agreements[0].collectedGrt).toBeCloseTo(3, 9);
  });

  it('drops an event it cannot attribute to an agreement', () => {
    const rows: StageRows = { collected: [row({ agreementId: undefined, tokens_dec: wei(9) })] };
    const s = buildAgreements(rows);
    expect(s.events).toEqual([]);
    expect(s.agreements).toEqual([]);
  });

  it('orders the event stream by block', () => {
    const rows: StageRows = {
      canceled: [row({ block_number: 30 })],
      offerStored: [row({ block_number: 10 })],
      accepted: [row({ block_number: 20 })],
    };
    expect(buildAgreements(rows).events.map((e) => e.block)).toEqual([10, 20, 30]);
  });

  it('counts each agreement once, under its furthest stage', () => {
    const rows: StageRows = {
      accepted: [row({ block_number: 1 }), row({ block_number: 1, agreementId: ID2 })],
      canceled: [row({ block_number: 2 })],
    };
    const s = buildAgreements(rows);

    expect(s.agreements).toHaveLength(2);
    expect(s.counts.cancelled).toBe(1);
    expect(s.counts.accepted).toBe(1);
  });

  it('records a withdrawn offer distinctly from a cancelled agreement', () => {
    const rows: StageRows = {
      offerStored: [row({ block_number: 1 })],
      offerCancelled: [row({ block_number: 2 })],
    };
    expect(buildAgreements(rows).agreements[0].status).toBe('offer-withdrawn');
  });
});

describe('forIndexer', () => {
  const rows: StageRows = {
    accepted: [
      row({ block_number: 1, serviceProvider: INDEXER, payer: PAYER }),
      row({ block_number: 1, agreementId: ID2, serviceProvider: OTHER, payer: PAYER }),
    ],
    collected: [
      row({ block_number: 2, tokens_dec: wei(7) }),
      row({ block_number: 2, agreementId: ID2, tokens_dec: wei(100) }),
    ],
  };

  it('keeps only the agreements of one service provider', () => {
    const mine = forIndexer(buildAgreements(rows), INDEXER);
    expect(mine.agreements.map((a) => a.id)).toEqual([ID]);
    expect(mine.totalCollectedGrt).toBeCloseTo(7, 9);
  });

  it('narrows the event stream to that provider too', () => {
    const mine = forIndexer(buildAgreements(rows), INDEXER);
    expect(mine.events.every((e) => e.agreementId === ID)).toBe(true);
  });

  it('matches a checksummed address', () => {
    const mine = forIndexer(buildAgreements(rows), INDEXER.toUpperCase().replace('0X', '0x'));
    expect(mine.agreements).toHaveLength(1);
  });

  it('reports empty for an indexer with no agreements, without claiming none exist', () => {
    const all = buildAgreements(rows);
    const none = forIndexer(all, '0x9999999999999999999999999999999999999999');

    expect(none.empty).toBe(true);
    expect(none.agreements).toEqual([]);
    // The network-wide view still knows about two, which is the distinction that matters.
    expect(all.agreements).toHaveLength(2);
  });
});
