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
 * `CATALYST_SOURCE_POST`. If you disagree with a score, that post is the thing
 * to disagree with.
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
    slug: 'gateway-operators',
    label: 'Onboard new gateway operators',
    coverage: 65,
    rationale:
      'Highest score because gib solves the genuinely hard technical part: a working TAP v2 / Horizon gateway used to be a multi-week ordeal and is now a compose file with a smoke test. The remaining 35% is whitelist coordination and money actually flowing, which was always going to be the Foundation’s job, so this is close to done as a community deliverable.',
    projects: [{ name: 'gib', url: 'https://github.com/nightswatchhq/gib' }],
  },
  {
    slug: 'rpc-service',
    label: 'The RPC data service',
    coverage: 60,
    rationale:
      'Dispatch exists as a live GRC-005 data service with real indexer provisioning. Docked because "the Foundation’s RPC service" implies official-track status, audits, gateway integration and go-to-market, none of which have happened. But they said they are still planning, and the plan is sitting on GitHub.',
    projects: [{ name: 'Dispatch (GRC-005)', url: 'https://github.com/nightswatchhq/dispatch' }],
  },
  {
    slug: 'substreams',
    label: 'Finish the Substreams data service',
    coverage: 55,
    rationale:
      'Live contract, settlement daemon, runbooks and a rehearsed end-to-end path: that is most of the engineering. The missing 45% is heavy though — external audit, multisig ownership, a hosted gateway/oracle, providers actually onboarded, and the official StreamingFast-blessed deployment. Code is the smaller half of shipping a data service people trust with funds.',
    projects: [{ name: 'SDSCE', url: 'https://github.com/nightswatchhq/SDSCE' }],
  },
  {
    slug: 'multi-product-studio',
    label: 'A multi-product Studio experience',
    coverage: 45,
    rationale:
      'Lodestar proves the concept and covers a lot of surface, but "the Foundation’s multi-product Studio" means thegraph.com, hosted syncs integration, subscription billing, and pulling the transitioned E&N stack into one experience. Lodestar is a strong reference implementation, not a drop-in.',
    projects: [{ name: 'Lodestar', url: '/' }],
  },
  {
    slug: 'studio-dips',
    label: 'Make Subgraph Studio fully network-powered',
    coverage: 40,
    rationale:
      'The frontend half is largely done — the Dock covers on-chain subgraph lifecycle, deploy keys, a playground and a metered gateway. The DIPS payments half, upgrade-indexer migration and indexers earning for syncs, is untouched protocol and ops work, and it is the half Pedro was actually talking about.',
    projects: [{ name: 'The Dock', url: '/dock' }],
  },
  {
    slug: 'memory-for-ai',
    label: 'Memory for AI',
    coverage: 25,
    rationale:
      'Scored on honesty: compass is the adjacent access and payment rail, not the memory service itself. The 25% credits that any agent-facing launch will need exactly what compass provides, plus Lodestar’s MCP directory as distribution.',
    projects: [
      { name: 'compass', url: 'https://github.com/nightswatchhq/compass' },
      { name: 'AI/MCP directory', url: '/ai' },
    ],
  },
  {
    slug: 'chain-integrations',
    label: 'Chain integrations data service',
    coverage: 5,
    rationale:
      'Nobody has built this. The 5% is only because the settlement patterns — TAP, Horizon data service contracts — are proven community territory now. The actual service, and crucially the business migration of existing chain deals onto it, is entirely Foundation work.',
    projects: [],
  },
  {
    slug: 'institutional-audit',
    label: 'Institutional audit layer',
    coverage: 0,
    rationale:
      'Pure business development and positioning. No repo can pre-build relationships with auditors and financial institutions, and Pedro himself conceded the SLA and SOC 2 gap.',
    projects: [],
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
 * the honest answer is that nobody knows the denominators. Equal weights land at
 * ~37%, which is the "roughly a third to 40%" claim in the post.
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
