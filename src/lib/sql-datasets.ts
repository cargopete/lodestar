// The public SQL catalogue: which nuthatch nests Lodestar exposes to anyone, and what each one is.
//
// An **explicit allowlist**, not a passthrough. The Helsinki host fronts eight nests behind one
// credential, and several exist to serve a single Lodestar panel. Proxying the lot because they
// happen to share a hostname is how a private dataset becomes public by accident, so a nest appears
// here only because someone decided it should.
//
// Safety on the SQL itself is the nest's job and it already does it properly: DuckDB opened with
// `enable_external_access=false`, an `allowed_directories` restriction and `lock_configuration=true`
// so a query cannot widen its own access, plus a function allowlist *and* denylist, comment
// stripping, and rejection of unknown table references. That is a surface built to be public
// (nuthatch RFC-0013/0034), which is why this proxy adds discovery rather than a second security
// model. `isReadOnlySql` in `sql-guard.ts` is defence in depth, not the defence.

export interface SqlDataset {
  /** URL-safe id, used in the API and the playground. */
  id: string;
  label: string;
  /** Path under the shared nuthatch origin. Empty string is the default nest. */
  basePath: string;
  /** What it indexes, in a sentence someone can act on. */
  description: string;
  /** The chain the contracts live on. */
  chain: string;
  /** A query that returns something interesting immediately, so the playground opens on a result. */
  sample: string;
  /**
   * A frozen archive rather than a live follower.
   *
   * Such a nest runs `nuthatch serve` with no cursor: it answers from sealed segments and never
   * advances, so `/ready` reports `stalled: true` for ever and is right to. Two things follow, and
   * both matter. The health check must not alert on it, or it cries wolf from day one and the next
   * real outage is ignored with it. And the reader must be told, because a page that shows an
   * archive beside three live datasets and says nothing is inviting someone to mistake three-week-old
   * data for current.
   */
  archival?: true;
}

/**
 * The opening query for a dataset whose table names are not pinned here.
 *
 * A sample that names a table is a sample that breaks the day that table is renamed, and the first
 * thing a visitor would see is an error on a page that works. `information_schema` cannot be wrong,
 * and listing the tables is the right first move in an unfamiliar dataset anyway.
 */
const LIST_TABLES = "SELECT table_name\nFROM information_schema.tables\nORDER BY table_name\nLIMIT 50";

export const SQL_DATASETS: SqlDataset[] = [
  {
    id: 'staking',
    label: 'Horizon staking',
    basePath: '',
    chain: 'Arbitrum One',
    description:
      'Four delegation events from HorizonStaking: TokensDelegated, TokensUndelegated, DelegatedTokensWithdrawn and StakeDelegatedWithdrawn. The source behind the delegation feed on this dashboard.',
    sample:
      'SELECT block_number, serviceProvider, delegator, tokens\nFROM staking__tokens_delegated\nORDER BY block_number DESC\nLIMIT 20',
  },
  {
    id: 'dips',
    label: 'DIPS',
    basePath: '/dips',
    chain: 'Arbitrum One',
    description:
      'Direct Indexer Payments: the Issuance Allocator, Recurring Agreement Manager and Recurring Collector. Nothing else indexes these three contracts, which is why the panel on this dashboard exists.',
    sample: LIST_TABLES,
  },
  {
    id: 'dips-sepolia',
    label: 'DIPS (Arbitrum Sepolia)',
    basePath: '/dips-sepolia',
    chain: 'Arbitrum Sepolia',
    description:
      'The same three DIPS contracts on the testnet where they have actually been exercised. Mainnet has produced zero agreement events; this carries 1,440, including 1,099 collections, which is what anything reading the agreement lifecycle should be developed against before it is pointed at mainnet.',
    sample:
      'SELECT block_number, agreementId, tokens_dec\nFROM recurring_collector__r_c_a_collected\nORDER BY block_number DESC\nLIMIT 20',
  },
  {
    id: 'gns',
    label: 'GNS / developer activity',
    basePath: '/gns',
    chain: 'Arbitrum One',
    description:
      'One table, gns__subgraph_published, from the GNS. Narrow by design: it is what the developer-activity chart on this dashboard counts.',
    sample: LIST_TABLES,
  },
  {
    id: 'legacy-flows',
    label: 'Legacy GRT flows',
    basePath: '/legacy-flows',
    chain: 'Arbitrum One',
    archival: true,
    description:
      'Delegation across the Horizon and pre-Horizon staking contracts together, which is what the GRT flow views need and what neither contract gives you alone. A frozen full-history archive, not a live follower: it answers from sealed segments and does not advance, so its data ends where the archive ends.',
    sample: LIST_TABLES,
  },
];

export function findDataset(id: string): SqlDataset | undefined {
  return SQL_DATASETS.find((d) => d.id === id);
}
