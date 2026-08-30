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

export const CATALYST_LAST_SCORED = '2026-08-30';

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
  /**
   * The highest score the *community* could reach. The gap above it is protocol or Foundation
   * policy: deals, migrations and governance parameters that no repository can close from outside.
   */
  communityCeiling: number;
  /**
   * The highest score reachable by The Night's Watch specifically, given that we build these
   * services and do not operate them, and that audits and legal entities are things we recommend
   * rather than buy. The gap between this and the community ceiling is the part that needs somebody
   * else, which is the most useful thing on this card.
   */
  ourCeiling: number;
  /** The last stretch is protocol or Foundation policy and cannot be engineered around. */
  ceilingLocked?: true;
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
    coverage: 74,
    communityCeiling: 90,
    ourCeiling: 75,
    ceilingLocked: true,
    rationale:
      'The biggest move of 28 Aug, from 25%. nutcracker implements it: contract, client crypto, provider store, local MCP shim. The design names a contradiction in the brief nobody had — end-to-end encryption and semantic recall do not compose, and the usual casualty is the encryption, via plaintext embeddings stored beside the ciphertext. It picks a keyed blind index instead and publishes measured recall rather than adjectives. It now runs: a provider binary and an MCP server you point an agent at, driven end to end in a real session where memories were sealed locally, stored, found by blinded bucket tokens and ranked after decryption. Two places where the obvious build would have been actively harmful are documented and tested against. Marked DOWN from 74% on 29 Aug after checking the retrieval half: the published recall figures were measured against uniformly random vectors, and transformer embeddings crowd into a narrow cone instead. On that geometry the false-candidate rate — which is the leakage — is 26% rather than 3%, and at severe anisotropy the index degenerates into matching everything. Mean-centring fixes it and is not yet implemented. Then measured on 30 Aug against nomic-embed-text: unrelated sentences sit at cosine 0.43, and at the default parameters the index retrieves 46% of related pairs while surfacing 22% of unrelated ones. Recall and disclosure move together and no setting buys both. Back up to 72% because the agent binary now runs a real local embedder instead of the bag-of-bytes placeholder, and refuses the three ways swapping one silently corrupts an index: a remote embedder, a changed model, and a fallback after failure.',
    projects: [
      { name: 'nutcracker', url: 'https://github.com/nightswatchhq/nutcracker' },
      { name: 'compass', url: 'https://github.com/nightswatchhq/compass' },
      { name: 'AI/MCP directory', url: '/ai' },
    ],
  },
  {
    slug: 'gateway-operators',
    label: 'Onboard new gateway operators',
    coverage: 68,
    communityCeiling: 95,
    ourCeiling: 75,
    rationale:
      'gib solves the genuinely hard technical part: a working TAP v2 / Horizon gateway used to be a multi-week ordeal and is now a compose file with a smoke test. Added since: `gib onboard`, which withholds the block an indexer must paste until your own side would actually work — the whitelist handshake is slow because every failure in it is discovered by the indexer, hours later, as receipts that bounce. The remaining third is money actually flowing and a second operator choosing to run it, and we have decided not to be that operator. Added 30 Aug: the invitation now leads somewhere. becoming-an-operator.md carries the four traps that cost us afternoons — a thawing period capped near 2,418,000 seconds so 30 days is refused by a nameless error, Horizon addresses in circulation that are implementations rather than proxies and return zero instead of reverting, the authorizeSigner step, and the provision requirement — plus a fork harness so an operator can prove they get paid before spending gas.',
    projects: [{ name: 'gib', url: 'https://github.com/nightswatchhq/gib' }],
  },
  {
    slug: 'multi-product-studio',
    label: 'A multi-product Studio experience',
    coverage: 66,
    communityCeiling: 90,
    ourCeiling: 70,
    rationale:
      'Lodestar proves the concept and covers a lot of surface, but "the Foundation\'s multi-product Studio" means thegraph.com, hosted syncs, subscription billing and the transitioned E&N stack in one experience. Lodestar is a strong reference implementation, not a drop-in. The binding constraint here is legal rather than technical: taking payment needs an entity. New on 29 Aug is a second product tier alongside subgraphs: /sql opens the nuthatch nests behind this dashboard to anyone, with a schema catalogue, a playground and results stamped with the block they were true as of. That gap was discovery rather than capability, since the paid door already existed and nobody outside could see a table name to knock on it. Added since: a named-query tier, where the caller sends a name and typed arguments and never sends SQL. Every declared query is pinned to a block, so its answer is reproducible and can carry a signed receipt, which is the difference between a surface for exploring and one you could depend on. And since 30 Aug the reverts are legible: a table of the 63 custom errors these contracts declare, wired into every write path in the Dock and published at /revert for operators who never touch this dashboard. Seconds become days, wei becomes GRT, and the documented traps are named as traps. Building it corrected our own operator doc: the thawing-period ceiling is 2,419,200 seconds, exactly 28 days, not the \'about 2,418,000\' the page claimed. And the invitation has a price on it now: each service publishes its own operator requirements through ProvisionManager, read live, and Dispatch and Seahorn ask 555 GRT against the Subgraph Service\'s 100,000. That is the bar everybody assumes applies, and it is roughly a hundred and eighty times the real one. And /operate rehearses the whole provider sequence for any pasted address against Arbitrum One, with no wallet and no gas: what it holds, what it has staked and provisioned, and which step it would fail on. The first check is the EIP-1967 slot, because calling an implementation instead of a proxy is the one trap with no error to decode.',
    projects: [
      { name: 'Lodestar', url: '/' },
      { name: 'SQL', url: '/sql' },
    ],
  },
  {
    slug: 'studio-dips',
    label: 'Make Subgraph Studio fully network-powered',
    coverage: 65,
    communityCeiling: 90,
    ourCeiling: 65,
    ceilingLocked: true,
    rationale:
      'The frontend half is largely done via the Dock. The news of 28 Aug is the protocol half: every DIPS contract is live on Arbitrum One and was fully wired on 25 August — issuance allocator, agreement manager, recurring collector, eligibility oracle — with the indexing-agreement allocation still set to zero. GIP-0088 is a governance parameter change away, not a deployment away. dips-nest indexes it and the dashboard shows it, so the moment that number moves is observable rather than announced. And the participating half turned out never to have been blocked: DIPS settles through RecurringCollector, not the query-fee path, so no gateway is involved. weaver builds and signs the agreements, and the whole accept() path is now exercised against the deployed RecurringCollector on a Sepolia fork: the happy path plus six ways it fails. That found a trap worth knowing about, because it costs a day: a payer must authorize their own key before any agreement they sign will verify, since the contract does not special-case signer == payer, and the revert blames the signature. And collect() is done too, on 30 Aug: the whole path runs against deployed Sepolia contracts, ending with the service provider actually being paid. The blocker was misstated — funded escrow is required for a broadcast, not for a fork, where GRT is dealt and the provision and deposit are ordinary calls. That leaves CAT-1 at its ceiling: what remains is a governance parameter and running pipelines we have decided not to run.',
    projects: [
      { name: 'dips-nest', url: 'https://github.com/nightswatchhq/dips-nest' },
      { name: 'The Dock', url: '/dock' },
    ],
  },
  {
    slug: 'substreams',
    label: 'Finish the Substreams data service',
    coverage: 58,
    communityCeiling: 95,
    ourCeiling: 65,
    rationale:
      'Live contract on Arbitrum One, settlement daemon, runbooks and a rehearsed end-to-end path: that is most of the engineering, and none of it moved on 28 Aug. The missing 42% is heavy — external audit, multisig ownership, a hosted gateway and oracle, and a provider actually onboarding. Code is the smaller half of shipping a data service people trust with funds.',
    projects: [{ name: 'SDSCE', url: 'https://github.com/nightswatchhq/SDSCE' }],
  },
  {
    slug: 'rpc-service',
    label: 'The RPC data service',
    coverage: 55,
    communityCeiling: 95,
    ourCeiling: 60,
    rationale:
      'Marked DOWN from 60%, and it is the honest direction. Three real improvements landed on 28 Aug: the April audit was re-scoped against the current contract and its one surviving High was disproved by a proof-of-concept rather than by argument, a live filter-routing bug was fixed, and a liveness probe now exists. All of it is outweighed by discovering that Dispatch had not answered a request in 39 days. 60% described a codebase; 50% describes a codebase whose operation is at zero. The contract is live, the code is maintained, and it is open to any operator. Added 30 Aug: an audit scope somebody else can fund — the surface measured, the settled parts fenced off so nobody pays to rediscover our homework, what to audit in the order we would pay for it, and what is explicitly out of scope. A tight brief is the difference between an affordable engagement and an open-ended one, and it is a thing a group with no audit budget can still produce.',
    projects: [{ name: 'Dispatch (GRC-005)', url: 'https://github.com/nightswatchhq/dispatch' }],
  },
  {
    slug: 'chain-integrations',
    label: 'Chain integrations data service',
    coverage: 48,
    communityCeiling: 85,
    ourCeiling: 48,
    ceilingLocked: true,
    rationale:
      'Was 5% because nobody had built it. chain-integration-ds now has the contract, the metering design, an integrator runbook and a deploy script. The design changed on contact with the protocol: supporting a chain is a commitment held over time, not a request, so it settles through RecurringCollector rather than per-query receipts — the Recurring Collection Agreement already has fields for an integration fee and an ongoing retainer. It does not go higher because nothing is deployed, and because the value-capture policy, which is most of what this item is, remains Council\'s. Fixed on 30 Aug: the contract could not be paid at all. It called the RecurringCollector to collect but never to accept, and accept is callable only by the data service an agreement names, so an agreement written for it could be accepted by nobody. Sixteen tests were silent because they ran against a mock that modelled no rule. Proven against the deployed collector on a Sepolia fork, then closed. The rehearsal that proved the fix then found a second fatal defect: collect() encoded four fields against a six-field struct, so every real collection would have reverted, and the mock was green because it stored the calldata without decoding it. Both fixed; the contract is now paid end to end against deployed contracts.',
    projects: [
      { name: 'chain-integration-ds', url: 'https://github.com/nightswatchhq/chain-integration-ds' },
    ],
  },
  {
    slug: 'institutional-audit',
    label: 'Institutional audit layer',
    coverage: 42,
    communityCeiling: 80,
    ourCeiling: 45,
    ceilingLocked: true,
    rationale:
      'Still mostly business development: SOC 2 and SLAs need a legal entity, which is not an engineering problem, and no repo pre-builds relationships with auditors. But the "deterministic ground-truth pipeline" this item asks for turned out not to be greenfield. nuthatch has been producing content-addressed sealed segments with a provenance stamp — the block an answer was true as of, how far the nest had sealed, the registry hash that decoded it — on a live box for six weeks. What was missing was a way to hand an answer to someone who does not trust you, and tattler is that: signed receipts you can verify offline, and replay against a different nest. Proven across two independently backfilled nests that both index TokensDelegated, which produced the identical hash. The finding underneath it is that an answer must pin its block, because nuthatch serves sealed history plus a moving tip and an unpinned answer cannot be reproduced by anyone, including whoever took it. And since 30 Aug the advisory half exists: institutional-readiness.md says what a body that has an entity should actually do, backed by measured SLOs from our own infrastructure rather than a framework — the SOC 2 observation window is calendar-bound so the clock starts in Q1 even if the code lands in Q4, and a signature makes tampering detectable while only replay makes lying detectable. Receipts now cover declared queries too, asked by name and typed arguments, and a named receipt replays by name: the other endpoint answers using its own definition rather than being asked to agree with your SQL, which is the only way a disagreement about the question itself can surface. And since 30 Aug a receipt can be disclosed from rather than only verified: every receipt commits to a Merkle root over the same sorted row hashes the result hash already folds together, so one row can be proved to have been in an answer without the answer being handed over. One delegation out of 34 is 1,991 bytes against the receipt\'s 10,271. The limit is stated on the page rather than buried: the leaves are not salted, so a neighbouring row can be guessed at by hashing it, which is no help against an address or a uint256 and trivial against a low-cardinality column.',
    projects: [
      { name: 'tattler', url: 'https://github.com/nightswatchhq/tattler' },
      { name: 'Verify a receipt', url: '/verify' },
    ],
  },
];

export interface CatalystSummary {
  /** Unweighted mean of every item score. */
  overall: number;
  /** Mean of what The Night's Watch alone could reach. */
  ourCeiling: number;
  /** Mean of what the community could reach with other people running things. */
  communityCeiling: number;
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
    // The two ceilings, averaged the same way, because the distance between them is the point.
    // "60% now, 63% is all we can reach, 90% is what the community could reach" says something the
    // single number cannot: that we are nearly done with the part that is ours alone, and the rest
    // needs other people to show up.
    ourCeiling: CATALYST_ITEMS.reduce((acc, i) => acc + i.ourCeiling, 0) / total,
    communityCeiling: CATALYST_ITEMS.reduce((acc, i) => acc + i.communityCeiling, 0) / total,
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
