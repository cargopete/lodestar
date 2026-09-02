// The Direct Indexer Payments agreement lifecycle, assembled from the dips-nest event tables.
//
// Every table read here is EMPTY on Arbitrum One today, and that is the reason to write this now
// rather than on the day it fills. The alternative is composing a view in a hurry, against real
// money, with everybody watching.
//
// ## Why separate `SELECT *` queries rather than one clever UNION
//
// The nest's own `dips_timeline` view unions its sources, and that is the right shape for a view
// living beside the data. This code cannot be exercised against a populated nest, so it is written
// to fail loudly rather than subtly: a `SELECT *` per table has no cross-branch type unification to
// get wrong, and a mistaken column name surfaces in TypeScript as `undefined` rather than as a
// query that returns plausible rubbish. The queries are tiny and the route is cached.
//
// They also run in one `Promise.all`, which costs exactly one `/ready` probe thanks to the
// in-flight coalescing in `nuthatch.ts`.
//
// ## Table names are from the nest's schema, not from guesswork
//
// `schema.json` in nightswatchhq/dips-nest is the source. Worth stating because the convention has
// a trap in it: `RCACollected` becomes `recurring_collector__r_c_a_collected`, not
// `..._rca_collected`, and a reasonable guess is wrong.

const GRT = 1e18;

/** Decimal-string wei to GRT. Absent reads as zero, never as NaN. */
const grt = (v: string | number | null | undefined) => (v == null || v === '' ? 0 : Number(v) / GRT);

/** `type(uint64).max`, which the collector uses to mean "no end date". */
const NO_END = '18446744073709551615';

/**
 * An agreement's end, or `null` where it has none.
 *
 * Two things here, both found by running this over Sepolia's real rows rather than fixtures.
 * 111 of the 113 agreements there carry the sentinel above, and it had been passing straight
 * through `Number()` into the response — where it becomes 18446744073709552000, because a u64 max
 * does not survive a double, and renders as a date in the year 584,542,046,090. A field that
 * exists to say "this never expires" was instead saying something absurd, confidently.
 *
 * Hence the comparison on the string. Converting first and then testing the number would depend on
 * exactly the precision loss that is the problem.
 */
function endsAt(v: unknown): number | null {
  if (v == null || v === '') return null;
  const raw = String(v);
  if (raw === NO_END) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** A big-int column arrives as `<name>_dec`; fall back to the raw column if it is absent. */
const big = (row: Record<string, unknown>, name: string) =>
  grt((row[`${name}_dec`] ?? row[name]) as string | number | null | undefined);

const addr = (v: unknown) => (typeof v === 'string' && v ? v.toLowerCase() : null);

/** Every lifecycle table this reads, in the order the stages happen. */
export const AGREEMENT_TABLES = {
  offerStored: 'recurring_collector__offer_stored',
  offerCancelled: 'recurring_collector__offer_cancelled',
  accepted: 'recurring_collector__agreement_accepted',
  updated: 'recurring_collector__agreement_updated',
  added: 'recurring_agreement_manager__agreement_added',
  rejected: 'recurring_agreement_manager__agreement_rejected',
  collected: 'recurring_collector__r_c_a_collected',
  canceled: 'recurring_collector__agreement_canceled',
  removed: 'recurring_agreement_manager__agreement_removed',
} as const;

export type AgreementStage = keyof typeof AGREEMENT_TABLES;

/**
 * Stage ranking, used to decide an agreement's current state when several events touch it.
 *
 * Not simply "the latest block wins": `collected` is a recurring event that says nothing about
 * whether the agreement later ended, so a collection must never demote a cancellation. Rank
 * expresses how far through the lifecycle a stage is, and the state is the highest rank reached.
 */
const STAGE_RANK: Record<AgreementStage, number> = {
  offerStored: 1,
  offerCancelled: 2,
  accepted: 3,
  updated: 3,
  added: 4,
  collected: 4,
  rejected: 5,
  canceled: 6,
  removed: 7,
};

const STAGE_STATUS: Record<AgreementStage, AgreementStatus> = {
  offerStored: 'offered',
  offerCancelled: 'offer-withdrawn',
  accepted: 'accepted',
  updated: 'accepted',
  added: 'active',
  collected: 'active',
  rejected: 'rejected',
  canceled: 'cancelled',
  removed: 'removed',
};

export type AgreementStatus =
  | 'offered'
  | 'offer-withdrawn'
  | 'accepted'
  | 'active'
  | 'rejected'
  | 'cancelled'
  | 'removed';

export interface AgreementEvent {
  stage: AgreementStage;
  status: AgreementStatus;
  agreementId: string;
  block: number;
  timestamp: number;
  txHash: string | null;
  payer: string | null;
  serviceProvider: string | null;
  dataService: string | null;
  /** GRT moved by this event, for `collected` only. */
  tokens: number | null;
}

export interface Agreement {
  id: string;
  payer: string | null;
  serviceProvider: string | null;
  dataService: string | null;
  status: AgreementStatus;
  /** Unix seconds of the first and most recent events touching it. */
  firstSeen: number;
  lastSeen: number;
  /** Terms, as of the most recent accept or update. */
  endsAt: number | null;
  maxInitialTokens: number | null;
  maxOngoingTokensPerSecond: number | null;
  /** Collections against this agreement. */
  collections: number;
  collectedGrt: number;
  dataServiceCutGrt: number;
  /** Enum straight from the contract; unlabelled because the meanings are not ours to invent. */
  rejectedReason: number | null;
  canceledBy: number | null;
}

export interface AgreementsSummary {
  agreements: Agreement[];
  events: AgreementEvent[];
  counts: Record<AgreementStatus, number>;
  totalCollectedGrt: number;
  /** True when no lifecycle event of any kind exists yet. */
  empty: boolean;
}

type Row = Record<string, unknown>;

/** The rows for each stage, as returned by the nest. */
export type StageRows = Partial<Record<AgreementStage, Row[]>>;

function eventOf(stage: AgreementStage, r: Row): AgreementEvent | null {
  const agreementId = typeof r.agreementId === 'string' ? r.agreementId : null;
  if (!agreementId) return null; // an event we cannot attribute is not an event we can show
  return {
    stage,
    status: STAGE_STATUS[stage],
    agreementId,
    block: Number(r.block_number ?? 0),
    timestamp: Number(r.block_timestamp ?? 0),
    txHash: typeof r.tx_hash === 'string' ? r.tx_hash : null,
    payer: addr(r.payer),
    serviceProvider: addr(r.serviceProvider ?? r.provider),
    dataService: addr(r.dataService),
    tokens: stage === 'collected' ? big(r, 'tokens') : null,
  };
}

/**
 * Fold the per-table rows into one agreement list and one ordered event stream.
 *
 * Pure, and takes the rows as an argument, so every interesting shape can be tested without a nest
 * — which matters more than usual here, because there is no populated nest to test against.
 */
export function buildAgreements(rows: StageRows): AgreementsSummary {
  const events: AgreementEvent[] = [];
  for (const stage of Object.keys(AGREEMENT_TABLES) as AgreementStage[]) {
    for (const r of rows[stage] ?? []) {
      const e = eventOf(stage, r);
      if (e) events.push(e);
    }
  }
  events.sort((a, b) => a.block - b.block || a.stage.localeCompare(b.stage));

  const byId = new Map<string, Agreement>();
  const rank = new Map<string, number>();

  for (const stage of Object.keys(AGREEMENT_TABLES) as AgreementStage[]) {
    for (const r of rows[stage] ?? []) {
      const id = typeof r.agreementId === 'string' ? r.agreementId : null;
      if (!id) continue;
      const block = Number(r.block_number ?? 0);
      const ts = Number(r.block_timestamp ?? 0);

      let a = byId.get(id);
      if (!a) {
        a = {
          id,
          payer: null,
          serviceProvider: null,
          dataService: null,
          status: STAGE_STATUS[stage],
          firstSeen: ts,
          lastSeen: ts,
          endsAt: null,
          maxInitialTokens: null,
          maxOngoingTokensPerSecond: null,
          collections: 0,
          collectedGrt: 0,
          dataServiceCutGrt: 0,
          rejectedReason: null,
          canceledBy: null,
        };
        byId.set(id, a);
        rank.set(id, 0);
      }

      // Identity fields: keep the first non-null seen. A later event omitting the payer must not
      // erase one an earlier event supplied.
      a.payer ??= addr(r.payer);
      a.serviceProvider ??= addr(r.serviceProvider ?? r.provider);
      a.dataService ??= addr(r.dataService);

      a.firstSeen = Math.min(a.firstSeen || ts, ts);
      a.lastSeen = Math.max(a.lastSeen, ts);

      if (stage === 'accepted' || stage === 'updated') {
        a.endsAt = endsAt(r.endsAt) ?? a.endsAt;
        a.maxInitialTokens = big(r, 'maxInitialTokens');
        a.maxOngoingTokensPerSecond = big(r, 'maxOngoingTokensPerSecond');
      }
      if (stage === 'collected') {
        a.collections += 1;
        a.collectedGrt += big(r, 'tokens');
        a.dataServiceCutGrt += big(r, 'dataServiceCut');
      }
      if (stage === 'rejected' && r.reason != null) a.rejectedReason = Number(r.reason);
      if (stage === 'canceled' && r.canceledBy != null) a.canceledBy = Number(r.canceledBy);

      // Furthest stage reached wins, so a routine collection cannot un-cancel an agreement.
      const thisRank = STAGE_RANK[stage] * 1_000_000 + Math.min(block, 999_999);
      if (thisRank >= (rank.get(id) ?? 0)) {
        rank.set(id, thisRank);
        a.status = STAGE_STATUS[stage];
      }
    }
  }

  const agreements = [...byId.values()].sort((x, y) => y.lastSeen - x.lastSeen);

  const counts = {
    offered: 0,
    'offer-withdrawn': 0,
    accepted: 0,
    active: 0,
    rejected: 0,
    cancelled: 0,
    removed: 0,
  } as Record<AgreementStatus, number>;
  for (const a of agreements) counts[a.status] += 1;

  return {
    agreements,
    events,
    counts,
    totalCollectedGrt: agreements.reduce((s, a) => s + a.collectedGrt, 0),
    empty: events.length === 0,
  };
}

/** Narrow a summary to one service provider. The per-indexer portfolio is this, and no more. */
export function forIndexer(summary: AgreementsSummary, indexer: string): AgreementsSummary {
  const target = indexer.toLowerCase();
  const agreements = summary.agreements.filter((a) => a.serviceProvider === target);
  const ids = new Set(agreements.map((a) => a.id));
  const counts = {
    offered: 0,
    'offer-withdrawn': 0,
    accepted: 0,
    active: 0,
    rejected: 0,
    cancelled: 0,
    removed: 0,
  } as Record<AgreementStatus, number>;
  for (const a of agreements) counts[a.status] += 1;

  return {
    agreements,
    events: summary.events.filter((e) => ids.has(e.agreementId)),
    counts,
    totalCollectedGrt: agreements.reduce((s, a) => s + a.collectedGrt, 0),
    empty: agreements.length === 0,
  };
}
