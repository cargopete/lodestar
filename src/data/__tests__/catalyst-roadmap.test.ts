import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CATALYST_ITEMS,
  CATALYST_LAST_SCORED,
  catalystSummary,
  coverageBand,
} from '../catalyst-roadmap';

const TRACKER = new URL('../../../docs/catalyst-community-roadmap.md', import.meta.url);

/** `CAT-n`, as the tracker numbers the workstreams, to the slug the card uses. */
const WS_TO_SLUG: Record<string, string> = {
  'CAT-1': 'studio-dips',
  'CAT-2': 'gateway-operators',
  'CAT-3': 'memory-for-ai',
  'CAT-4': 'substreams',
  'CAT-5': 'rpc-service',
  'CAT-6': 'multi-product-studio',
  'CAT-7': 'chain-integrations',
  'CAT-8': 'institutional-audit',
};

/**
 * Parse the scoreboard out of the tracker markdown.
 *
 * Anchored on the header row rather than on `| CAT-n |`, because the tracker carries a second
 * table whose rows also start that way (the ceiling re-cut), and matching both would compare a
 * score against a ceiling.
 */
function trackerScoreboard(): { scores: Record<string, number>; asOf: string } {
  const lines = readFileSync(TRACKER, 'utf8').split('\n');
  const head = lines.findIndex((l) => l.startsWith('| WS | Item |'));
  if (head < 0) throw new Error('the tracker has no scoreboard table');

  const date = /\*\*Current \((\d{2})-(\d{2})\)\*\*/.exec(lines[head]);
  if (!date) throw new Error('the scoreboard header carries no "Current (MM-DD)" date');

  const scores: Record<string, number> = {};
  for (const line of lines.slice(head + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const slug = WS_TO_SLUG[cells[0]];
    if (!slug) throw new Error(`unknown workstream in the scoreboard: ${cells[0]}`);
    const current = /(\d+)%/.exec(cells[4] ?? '');
    if (!current) throw new Error(`no current score in scoreboard row: ${line}`);
    scores[slug] = Number(current[1]);
  }
  return { scores, asOf: `2026-${date[1]}-${date[2]}` };
}

describe('CATALYST_ITEMS', () => {
  it('scores every item within 0–100', () => {
    for (const item of CATALYST_ITEMS) {
      expect(item.coverage).toBeGreaterThanOrEqual(0);
      expect(item.coverage).toBeLessThanOrEqual(100);
    }
  });

  it('has unique slugs', () => {
    const slugs = CATALYST_ITEMS.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('is ordered by coverage descending, since the card renders array order', () => {
    const scores = CATALYST_ITEMS.map((i) => i.coverage);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('argues every score', () => {
    for (const item of CATALYST_ITEMS) {
      expect(item.rationale.length).toBeGreaterThan(40);
    }
  });
});

describe('catalystSummary', () => {
  it('reproduces the headline the card renders', () => {
    const { overall } = catalystSummary();
    expect(overall).toBeCloseTo(59, 3);
  });

  /**
   * The card is public and the tracker is internal, and they drifted badly once already: the
   * card said 37% and Dispatch 60% for hours after the tracker knew better.
   *
   * This assertion used to compare the card against eight numbers typed into this file, which
   * pinned the card to a *copy* of the tracker rather than to the tracker. Editing the markdown
   * and forgetting the card left the suite green, which is precisely the drift it was written to
   * catch. It reads the markdown now.
   */
  it('matches the delivery tracker, which is the thing that drifts', () => {
    const card = Object.fromEntries(CATALYST_ITEMS.map((i) => [i.slug, i.coverage]));
    expect(card).toEqual(trackerScoreboard().scores);
  });

  /**
   * The card tells the public when these numbers were last argued. It said 28 August for two days
   * while five of the eight moved underneath it, which makes the disclosure worse than none: a
   * reader who checks the date is being told the staleness they were right to suspect is absent.
   */
  it('is dated when the tracker last moved a number, not when it was opened', () => {
    expect(CATALYST_LAST_SCORED).toBe(trackerScoreboard().asOf);
  });

  it('counts items with and without community work', () => {
    const { covered, untouched, total } = catalystSummary();
    expect(covered + untouched).toBe(total);
    expect(total).toBe(CATALYST_ITEMS.length);
  });
});

describe('coverageBand', () => {
  it('bands on the 50 and 25 boundaries', () => {
    expect(coverageBand(65)).toBe('strong');
    expect(coverageBand(50)).toBe('strong');
    expect(coverageBand(49)).toBe('partial');
    expect(coverageBand(25)).toBe('partial');
    expect(coverageBand(24)).toBe('foundation');
    expect(coverageBand(0)).toBe('foundation');
  });
});
