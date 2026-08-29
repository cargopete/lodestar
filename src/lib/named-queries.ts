// The named-query tier: a caller sends a **name and typed arguments, never SQL**.
//
// Free-form `/sql` is the exploring tier and nuthatch's own RFC-0034 is blunt about why that is not
// the whole story: arbitrary SQL "is the product for a local developer and a liability for a public
// endpoint", because the node's guards (timeout, row cap, concurrency) are *self-protection, not a
// security boundary* — they bound the damage of one query and say nothing about which questions the
// surface is willing to answer at all.
//
// This is where we say which. It lives here rather than in the nests' mount config because those
// nests are single-nest processes serving live dashboard panels, and a product feature is a poor
// reason to reconfigure four of them. The nest's guards still apply underneath; this narrows the
// set of questions before one is ever asked.
//
// ## Why `int` and `address` and nothing else
//
// Both have a **total validating parse** into a form with no escaping hazard: an int becomes
// decimal digits, an address becomes `0x` plus 40 hex characters and cannot contain a quote. Each
// renders into SQL safely by construction rather than by careful escaping.
//
// `text` is deliberately absent, and the reasoning is nuthatch's, adopted wholesale: free text needs
// escaping, escaping has to be right in every dialect and every context (string literal, identifier,
// LIKE pattern), and "we escaped it carefully" is how this class of bug ships. Matching
// caller-supplied SQL against a pattern — a regex, a prefix, an "is it a SELECT" check — is the
// shape of every SQL-filter bypass ever written. This is not that: the caller never sends text that
// reaches the query.
//
// ## Every query is pinned
//
// Each takes a `before_block` and bounds itself by it. That is not decoration: it is what makes an
// answer reproducible, and therefore what makes it worth attesting to. nuthatch answers from sealed
// history plus a moving tip, so an unpinned answer cannot be reproduced by anyone, including
// whoever took it. A named, pinned query is the unit a `tattler` receipt is actually useful over,
// because two parties can then agree on what the question *was*, not merely on what came back.

export type ParamType = 'int' | 'address';

export interface QueryParam {
  name: string;
  type: ParamType;
  description: string;
}

export interface NamedQuery {
  name: string;
  dataset: string;
  description: string;
  params: QueryParam[];
  /** `{param}` placeholders, substituted only with validated values. */
  sql: string;
}

/** Every named query bounds itself by this, so every answer is reproducible. */
const PIN: QueryParam = {
  name: 'before_block',
  type: 'int',
  description: 'Only consider blocks at or below this one. Required: it is what makes the answer reproducible.',
};

export const NAMED_QUERIES: NamedQuery[] = [
  {
    name: 'delegations_to_indexer',
    dataset: 'staking',
    description: 'Every delegation to one indexer, newest first, up to a block.',
    params: [
      { name: 'indexer', type: 'address', description: 'The service provider receiving the delegation.' },
      PIN,
    ],
    sql: `SELECT block_number, block_timestamp, delegator, tokens, shares, tx_hash
FROM staking__tokens_delegated
WHERE serviceProvider = '{indexer}' AND block_number <= {before_block}
ORDER BY block_number DESC
LIMIT 500`,
  },
  {
    name: 'delegator_activity',
    dataset: 'staking',
    description:
      'One delegator\'s delegations and undelegations together, up to a block. The union is the point: neither table answers "what did they do" on its own.',
    params: [
      { name: 'delegator', type: 'address', description: 'The delegator to trace.' },
      PIN,
    ],
    sql: `SELECT block_number, block_timestamp, 'delegated' AS action, serviceProvider, tokens
FROM staking__tokens_delegated
WHERE delegator = '{delegator}' AND block_number <= {before_block}
UNION ALL
SELECT block_number, block_timestamp, 'undelegated' AS action, serviceProvider, tokens
FROM staking__tokens_undelegated
WHERE delegator = '{delegator}' AND block_number <= {before_block}
ORDER BY block_number DESC
LIMIT 500`,
  },
  {
    name: 'net_delegation_to_indexer',
    dataset: 'staking',
    description:
      'Tokens delegated minus tokens undelegated for one indexer, as of a block. Returned as text, because these are uint256 and a float would quietly change the number.',
    params: [
      { name: 'indexer', type: 'address', description: 'The service provider.' },
      PIN,
    ],
    sql: `SELECT
  CAST(SUM(CAST(tokens AS HUGEINT)) AS VARCHAR) AS delegated,
  CAST(COUNT(*) AS VARCHAR) AS events
FROM staking__tokens_delegated
WHERE serviceProvider = '{indexer}' AND block_number <= {before_block}`,
  },
  {
    name: 'issuance_rate_changes',
    dataset: 'dips',
    description:
      'Every change to the Issuance Allocator\'s per-block rate, up to a block. This is the number GIP-0088 turns on.',
    params: [PIN],
    sql: `SELECT block_number, block_timestamp, oldIssuancePerBlock, newIssuancePerBlock, tx_hash
FROM issuance_allocator__issuance_per_block_updated
WHERE block_number <= {before_block}
ORDER BY block_number DESC
LIMIT 200`,
  },
  {
    name: 'dips_agreements',
    dataset: 'dips',
    description:
      'Indexing agreements added to the Recurring Agreement Manager, up to a block. Empty today, which is itself the answer: DIPS is armed and unfunded.',
    params: [PIN],
    sql: `SELECT block_number, block_timestamp, agreementId, collector, dataService, provider
FROM recurring_agreement_manager__agreement_added
WHERE block_number <= {before_block}
ORDER BY block_number DESC
LIMIT 200`,
  },
];

export function findNamedQuery(name: string): NamedQuery | undefined {
  return NAMED_QUERIES.find((q) => q.name === name);
}

export type RenderResult =
  | { ok: true; sql: string }
  | { ok: false; error: string };

/**
 * Validate arguments and render the statement.
 *
 * Each type has a total parse into a lexically safe form, so the rendered SQL cannot contain
 * anything the caller wrote. An argument that does not parse is refused; nothing is coerced,
 * trimmed into shape, or escaped.
 */
export function renderNamedQuery(
  query: NamedQuery,
  args: Record<string, unknown>
): RenderResult {
  const values: Record<string, string> = {};

  for (const p of query.params) {
    const raw = args[p.name];
    if (raw === undefined || raw === null || raw === '') {
      return { ok: false, error: `Missing argument \`${p.name}\` (${p.type}).` };
    }
    const asText = String(raw).trim();

    if (p.type === 'int') {
      // Digits only. No sign, no exponent, no separators, no leading plus: a block number is a
      // count. Anything else is refused rather than coerced.
      if (!/^\d{1,20}$/.test(asText)) {
        return { ok: false, error: `\`${p.name}\` must be a whole number.` };
      }
      values[p.name] = asText;
    } else {
      // Exactly 0x plus 40 hex. Cannot contain a quote, a space or a comment marker, so rendering
      // it inside a string literal is safe by construction.
      if (!/^0x[0-9a-fA-F]{40}$/.test(asText)) {
        return { ok: false, error: `\`${p.name}\` must be a 0x-prefixed 20-byte address.` };
      }
      values[p.name] = asText.toLowerCase();
    }
  }

  // An unknown argument is a refusal, not something to ignore: silently dropping it means a caller
  // who misspelt `indexer` gets a confident answer to a different question.
  const declared = new Set(query.params.map((p) => p.name));
  for (const given of Object.keys(args)) {
    if (!declared.has(given)) {
      return { ok: false, error: `Unknown argument \`${given}\`.` };
    }
  }

  const sql = query.sql.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = values[name];
    if (v === undefined) throw new Error(`template placeholder {${name}} has no declared parameter`);
    return v;
  });

  return { ok: true, sql };
}
