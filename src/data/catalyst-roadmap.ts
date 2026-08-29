/**
 * Project Catalyst coverage — curated editorial dataset.
 *
 * The Foundation's Project Catalyst roadmap, scored against what the community
 * has already built in public. This is a hand-assigned judgement call, not a
 * measurement: `coverage` is one person's estimate of the share of *total* work
 * (code + deployment + adoption) that community projects have already covered,
 * not whether a repo merely exists. Treat it as an argued opinion with links
 * attached, and see `CATALYST_LAST_SCORED` for when it was last argued.
 *
 * The reasoning behind every number is in the post linked from
 * `CATALYST_SOURCE_POST`; the working is in the delivery tracker at
 * `CATALYST_TRACKER_URL`. If you disagree with a score, those are the things to
 * disagree with.
 *
 * Rescored 2026-08-28 after a day of building against the roadmap. Several
 * numbers moved because work landed. Two moved because we went and checked
 * something and it was worse than assumed, which is the more useful kind of
 * movement and the reason this is dated rather than evergreen.
 */

export const CATALYST_LAST_SCORED = '2026-08-28';

export const CATALYST_SOURCE_POST = '/blog/we-read-the-foundations-new-roadmap';

/**
 * The delivery tracker behind these numbers: every workstream, what is verified
 * on-chain today, and the checklist to close each gap. Lives in the repo rather
 * than on the site because it is a working document that changes as tasks are
 * ticked, and because the audit trail of who changed a claim, and when, matters
 * more here than presentation.
 */
export const CATALYST_TRACKER_URL =
  'https://github.com/nightswatchhq/lodestar/blob/main/docs/catalyst-community-roadmap.md';

export interface CatalystProject {
  name: string;
  url: string;
}

export interface CatalystItem {
  slug: string;
  /** The roadmap item, phrased as the Foundation phrased it. */
  label: string;
  /** 0–100. Share of total work already covered by community projects. */
  coverage: number;
  /** Why that number and not a different one. Shown when the row is expanded. */
  rationale: string;
  /** What the community has actually shipped against it. Empty when nobody has. */
  projects: CatalystProject[];
}

/** Ordered by coverage, descending — the card renders them in array order. */
export const CATALYST_ITEMS: CatalystItem[] = [
  {
    slug: 'memory-for-ai',
    label: 'Memory for AI',
    coverage: 68,
    rationale:
      'The biggest move of 28 Aug, from 25%. nutcracker implements it: contract, client crypto, provider store, local MCP shim. The design names a contradiction in the brief nobody had — end-to-end encryption and semantic recall do not compose, and the usual casualty is the encryption, via plaintext embeddings stored beside the ciphertext. It picks a keyed blind index instead and publishes measured recall rather than adjectives. It now runs: a provider binary and an MCP server you point an agent at, driven end to end in a real session where memories were sealed locally, stored, found by blinded bucket tokens and ranked after decryption. Two places where the obvious build would have been actively harmful are documented and tested against. Marked DOWN from 74% on 29 Aug after checking the retrieval half: the published recall figures were measured against uniformly random vectors, and transformer embeddings crowd into a narrow cone instead. On that geometry the false-candidate rate — which is the leakage — is 26% rather than 3%, and at severe anisotropy the index degenerates into matching everything. Mean-centring fixes it and is not yet implemented. Nothing is broken and no claim was dishonest, but half the product is semantic recall and that half has never been measured against a real embedding model.',
    projects: [
      { name: 'nutcracker', url: 'https://github.com/nightswatchhq/nutcracker' },
      { name: 'compass', url: 'https://github.com/nightswatchhq/compass' },
      { name: 'AI/MCP directory', url: '/ai' },
    ],
  },
  {
    slug: 'gateway-operators',
    label: 'Onboard new gateway operators',
    coverage: 64,
    rationale:
      'gib solves the genuinely hard technical part: a working TAP v2 / Horizon gateway used to be a multi-week ordeal and is now a compose file with a smoke test. Added since: `gib onboard`, which withholds the block an indexer must paste until your own side would actually work — the whitelist handshake is slow because every failure in it is discovered by the indexer, hours later, as receipts that bounce. The remaining third is money actually flowing and a second operator choosing to run it, and we have decided not to be that operator.',
    projects: [{ name: 'gib', url: 'https://github.com/nightswatchhq/gib' }],
  },
  {
    slug: 'studio-dips',
    label: 'Make Subgraph Studio fully network-powered',
    coverage: 62,
    rationale:
      'The frontend half is largely done via the Dock. The news of 28 Aug is the protocol half: every DIPS contract is live on Arbitrum One and was fully wired on 25 August — issuance allocator, agreement manager, recurring collector, eligibility oracle — with the indexing-agreement allocation still set to zero. GIP-0088 is a governance parameter change away, not a deployment away. dips-nest indexes it and the dashboard shows it, so the moment that number moves is observable rather than announced. And the participating half turned out never to have been blocked: DIPS settles through RecurringCollector, not the query-fee path, so no gateway is involved. weaver builds and signs the agreements, and the whole accept() path is now exercised against the deployed RecurringCollector on a Sepolia fork: the happy path plus six ways it fails. That found a trap worth knowing about, because it costs a day: a payer must authorize their own key before any agreement they sign will verify, since the contract does not special-case signer == payer, and the revert blames the signature. collect() still needs funded escrow and is not done.',
    projects: [
      { name: 'dips-nest', url: 'https://github.com/nightswatchhq/dips-nest' },
      { name: 'The Dock', url: '/dock' },
    ],
  },
  {
    slug: 'multi-product-studio',
    label: 'A multi-product Studio experience',
    coverage: 60,
    rationale:
      'Lodestar proves the concept and covers a lot of surface, but "the Foundation\'s multi-product Studio" means thegraph.com, hosted syncs, subscription billing and the transitioned E&N stack in one experience. Lodestar is a strong reference implementation, not a drop-in. The binding constraint here is legal rather than technical: taking payment needs an entity. New on 29 Aug is a second product tier alongside subgraphs: /sql opens the nuthatch nests behind this dashboard to anyone, with a schema catalogue, a playground and results stamped with the block they were true as of. That gap was discovery rather than capability, since the paid door already existed and nobody outside could see a table name to knock on it. Added since: a named-query tier, where the caller sends a name and typed arguments and never sends SQL. Every declared query is pinned to a block, so its answer is reproducible and can carry a signed receipt, which is the difference between a surface for exploring and one you could depend on.',
    projects: [
      { name: 'Lodestar', url: '/' },
      { name: 'SQL', url: '/sql' },
    ],
  },
  {
    slug: 'substreams',
    label: 'Finish the Substreams data service',
    coverage: 58,
    rationale:
      'Live contract on Arbitrum One, settlement daemon, runbooks and a rehearsed end-to-end path: that is most of the engineering, and none of it moved on 28 Aug. The missing 42% is heavy — external audit, multisig ownership, a hosted gateway and oracle, and a provider actually onboarding. Code is the smaller half of shipping a data service people trust with funds.',
    projects: [{ name: 'SDSCE', url: 'https://github.com/nightswatchhq/SDSCE' }],
  },
  {
    slug: 'rpc-service',
    label: 'The RPC data service',
    coverage: 50,
    rationale:
      'Marked DOWN from 60%, and it is the honest direction. Three real improvements landed on 28 Aug: the April audit was re-scoped against the current contract and its one surviving High was disproved by a proof-of-concept rather than by argument, a live filter-routing bug was fixed, and a liveness probe now exists. All of it is outweighed by discovering that Dispatch had not answered a request in 39 days. 60% described a codebase; 50% describes a codebase whose operation is at zero. The contract is live, the code is maintained, and it is open to any operator.',
    projects: [{ name: 'Dispatch (GRC-005)', url: 'https://github.com/nightswatchhq/dispatch' }],
  },
  {
    slug: 'chain-integrations',
    label: 'Chain integrations data service',
    coverage: 35,
    rationale:
      'Was 5% because nobody had built it. chain-integration-ds now has the contract, the metering design, an integrator runbook and a deploy script. The design changed on contact with the protocol: supporting a chain is a commitment held over time, not a request, so it settles through RecurringCollector rather than per-query receipts — the Recurring Collection Agreement already has fields for an integration fee and an ongoing retainer. It does not go higher because nothing is deployed, and because the value-capture policy, which is most of what this item is, remains Council\'s.',
    projects: [
      { name: 'chain-integration-ds', url: 'https://github.com/nightswatchhq/chain-integration-ds' },
    ],
  },
  {
    slug: 'institutional-audit',
    label: 'Institutional audit layer',
    coverage: 30,
    rationale:
      'Still mostly business development: SOC 2 and SLAs need a legal entity, which is not an engineering problem, and no repo pre-builds relationships with auditors. But the "deterministic ground-truth pipeline" this item asks for turned out not to be greenfield. nuthatch has been producing content-addressed sealed segments with a provenance stamp — the block an answer was true as of, how far the nest had sealed, the registry hash that decoded it — on a live box for six weeks. What was missing was a way to hand an answer to someone who does not trust you, and tattler is that: signed receipts you can verify offline, and replay against a different nest. Proven across two independently backfilled nests that both index TokensDelegated, which produced the identical hash. The finding underneath it is that an answer must pin its block, because nuthatch serves sealed history plus a moving tip and an unpinned answer cannot be reproduced by anyone, including whoever took it. Receipts now cover declared queries too, asked by name and typed arguments, and a named receipt replays by name: the other endpoint answers using its own definition rather than being asked to agree with your SQL, which is the only way a disagreement about the question itself can surface.',
    projects: [
      { name: 'tattler', url: 'https://github.com/nightswatchhq/tattler' },
      { name: 'Verify a receipt', url: '/verify' },
    ],
  },
];

export interface CatalystSummary {
  /** Unweighted mean of every item score. */
  overall: number;
  /** Items with at least one community project behind them. */
  covered: number;
  /** Items nothing has been built against yet. */
  untouched: number;
  total: number;
}

/**
 * Headline number for the card.
 *
 * Deliberately an unweighted mean: weighting the eight items by "how much work
 * each really is" would be a second layer of guesswork stacked on the first, and
 * the honest answer is that nobody knows the denominators. Equal weights landed
 * at ~37% when this was first argued and at ~46% after 28 Aug.
 */
export function catalystSummary(): CatalystSummary {
  const total = CATALYST_ITEMS.length;
  const sum = CATALYST_ITEMS.reduce((acc, i) => acc + i.coverage, 0);
  return {
    overall: sum / total,
    covered: CATALYST_ITEMS.filter((i) => i.projects.length > 0).length,
    untouched: CATALYST_ITEMS.filter((i) => i.projects.length === 0).length,
    total,
  };
}

/** Score bands, used for bar colour and the row's badge. */
export type CoverageBand = 'strong' | 'partial' | 'foundation';

export function coverageBand(coverage: number): CoverageBand {
  if (coverage >= 50) return 'strong';
  if (coverage >= 25) return 'partial';
  return 'foundation';
}
