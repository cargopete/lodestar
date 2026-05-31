import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the @/lib/db boundary. `db` is a tagged-template function (postgres.js
// style) — call it with (strings, ...values) and it returns a promise of rows.
// We record every call and return a queue of canned result sets.
// ---------------------------------------------------------------------------

interface DbCall {
  text: string;
  values: unknown[];
}

const calls: DbCall[] = [];
let resultQueue: unknown[][] = [];

const dbTag = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values });
  const next = resultQueue.length ? resultQueue.shift()! : [];
  return Promise.resolve(next);
});

vi.mock('@/lib/db', () => ({
  db: (strings: TemplateStringsArray, ...values: unknown[]) =>
    (dbTag as (...a: unknown[]) => unknown)(strings, ...values),
  hasDbAccess: vi.fn(() => true),
}));

/** Queue the result sets that successive db`` calls will resolve to. */
function queueResults(...sets: unknown[][]) {
  resultQueue = sets;
}

beforeEach(() => {
  calls.length = 0;
  resultQueue = [];
  dbTag.mockClear();
});

describe('studio/db — subgraphs', () => {
  it('listSubgraphs lowercases owner and returns rows', async () => {
    const rows = [{ id: 1, owner_address: '0xabc' }];
    queueResults(rows);
    const { listSubgraphs } = await import('@/lib/studio/db');
    const out = await listSubgraphs('0xABCDEF');
    expect(out).toBe(rows);
    expect(calls).toHaveLength(1);
    expect(calls[0].values).toContain('0xabcdef');
    expect(calls[0].text).toContain('studio_subgraphs');
  });

  it('getSubgraphBySlug returns the first row or null', async () => {
    const { getSubgraphBySlug } = await import('@/lib/studio/db');
    queueResults([{ id: 7, slug: 'foo' }]);
    expect(await getSubgraphBySlug('foo')).toEqual({ id: 7, slug: 'foo' });
    queueResults([]);
    expect(await getSubgraphBySlug('missing')).toBeNull();
  });

  it('getSubgraphById returns the first row or null', async () => {
    const { getSubgraphById } = await import('@/lib/studio/db');
    queueResults([{ id: 3 }]);
    expect(await getSubgraphById(3)).toEqual({ id: 3 });
    queueResults([]);
    expect(await getSubgraphById(99)).toBeNull();
  });

  it('createSubgraph returns the inserted row and lowercases owner', async () => {
    const { createSubgraph } = await import('@/lib/studio/db');
    queueResults([{ id: 10, owner_address: '0xdead', slug: 's' }]);
    const out = await createSubgraph('0xDEAD', 's', 'My Graph');
    expect(out).toEqual({ id: 10, owner_address: '0xdead', slug: 's' });
    expect(calls[0].text).toContain('INSERT INTO studio_subgraphs');
    expect(calls[0].values).toEqual(['0xdead', 's', 'My Graph']);
  });

  it('updateSubgraphDeployment issues an UPDATE and resolves void', async () => {
    const { updateSubgraphDeployment } = await import('@/lib/studio/db');
    await expect(
      updateSubgraphDeployment('slug', 'Qmdep', 'mainnet'),
    ).resolves.toBeUndefined();
    expect(calls[0].text).toContain('UPDATE studio_subgraphs');
    expect(calls[0].values).toEqual(['Qmdep', 'mainnet', 'slug']);
  });

  it('setPublishedSubgraphId defaults optional args to null', async () => {
    const { setPublishedSubgraphId } = await import('@/lib/studio/db');
    await setPublishedSubgraphId(5, '0xOWN', 'pub-1');
    // SET values..., then WHERE id + owner
    expect(calls[0].values).toEqual(['pub-1', null, null, 5, '0xown']);
  });

  it('updateVersionLabel passes through label and defaults deployment to null', async () => {
    const { updateVersionLabel } = await import('@/lib/studio/db');
    await updateVersionLabel(5, '0xOWN', 'v0.0.1');
    expect(calls[0].values).toEqual(['v0.0.1', null, 5, '0xown']);
  });

  it('deleteSubgraph issues a DELETE scoped to id + owner', async () => {
    const { deleteSubgraph } = await import('@/lib/studio/db');
    await deleteSubgraph(42, '0xOWN');
    expect(calls[0].text).toContain('DELETE FROM studio_subgraphs');
    expect(calls[0].values).toEqual([42, '0xown']);
  });
});

describe('studio/db — deploy keys', () => {
  it('getDeployKey returns first row or null', async () => {
    const { getDeployKey } = await import('@/lib/studio/db');
    queueResults([{ key_hash: 'h', created_at: 't', last_used_at: null }]);
    expect(await getDeployKey('0xA')).toEqual({
      key_hash: 'h',
      created_at: 't',
      last_used_at: null,
    });
    queueResults([]);
    expect(await getDeployKey('0xB')).toBeNull();
  });

  it('findOwnerByKeyHash returns null without a touch UPDATE when absent', async () => {
    const { findOwnerByKeyHash } = await import('@/lib/studio/db');
    queueResults([]);
    expect(await findOwnerByKeyHash('nohash')).toBeNull();
    expect(calls).toHaveLength(1); // SELECT only, no UPDATE
  });

  it('findOwnerByKeyHash bumps last_used_at then returns the owner', async () => {
    const { findOwnerByKeyHash } = await import('@/lib/studio/db');
    queueResults([{ owner_address: '0xowner' }], []);
    expect(await findOwnerByKeyHash('hash')).toBe('0xowner');
    expect(calls).toHaveLength(2);
    expect(calls[1].text).toContain('UPDATE studio_deploy_keys');
    expect(calls[1].text).toContain('last_used_at');
  });
});

describe('studio/db — api keys', () => {
  it('createApiKey returns the inserted row', async () => {
    const { createApiKey } = await import('@/lib/studio/db');
    queueResults([{ id: 1, key_prefix: 'lod_live_ab12' }]);
    const out = await createApiKey('0xOWN', 'label', 'hash', 'lod_live_ab12');
    expect(out).toEqual({ id: 1, key_prefix: 'lod_live_ab12' });
    expect(calls[0].values).toEqual(['0xown', 'label', 'hash', 'lod_live_ab12']);
  });

  it('findApiKeyByHash returns null (no UPDATE) when absent', async () => {
    const { findApiKeyByHash } = await import('@/lib/studio/db');
    queueResults([]);
    expect(await findApiKeyByHash('nope')).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('findApiKeyByHash returns the row and bumps last_used_at', async () => {
    const { findApiKeyByHash } = await import('@/lib/studio/db');
    queueResults([{ id: 9, owner_address: '0xo', status: 'active' }], []);
    expect(await findApiKeyByHash('h')).toEqual({
      id: 9,
      owner_address: '0xo',
      status: 'active',
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].text).toContain('UPDATE studio_api_keys');
  });

  it('getKeyUsage maps the count to a number, 0 when absent', async () => {
    const { getKeyUsage } = await import('@/lib/studio/db');
    queueResults([{ query_count: '17' }]);
    expect(await getKeyUsage(1, '2026-05')).toBe(17);
    queueResults([]);
    expect(await getKeyUsage(1, '2026-05')).toBe(0);
  });

  it('getGlobalUsage coalesces SUM to a number', async () => {
    const { getGlobalUsage } = await import('@/lib/studio/db');
    queueResults([{ total: '123' }]);
    expect(await getGlobalUsage('2026-05')).toBe(123);
    queueResults([{ total: null }]);
    expect(await getGlobalUsage('2026-05')).toBe(0);
  });

  it('getOwnerUsage joins and returns a number', async () => {
    const { getOwnerUsage } = await import('@/lib/studio/db');
    queueResults([{ total: '5' }]);
    expect(await getOwnerUsage('0xOWN', '2026-05')).toBe(5);
    expect(calls[0].values).toContain('0xown');
    expect(calls[0].text).toContain('JOIN studio_api_keys');
  });
});

describe('studio/db — bounties', () => {
  it('listBounties filters by deployment when given', async () => {
    const { listBounties } = await import('@/lib/studio/db');
    queueResults([{ id: 1 }]);
    await listBounties('Qmdep');
    expect(calls[0].text).toContain('deployment_id');
    expect(calls[0].values).toEqual(['Qmdep']);
  });

  it('listBounties uses the global open/claimed ordering when no deployment', async () => {
    const { listBounties } = await import('@/lib/studio/db');
    queueResults([]);
    await listBounties();
    expect(calls[0].text).toContain('LIMIT 100');
    expect(calls[0].values).toEqual([]);
  });

  it('createBounty lowercases developer and defaults optionals to null', async () => {
    const { createBounty } = await import('@/lib/studio/db');
    queueResults([{ id: 1, amount_grt: '100' }]);
    const out = await createBounty({
      deployment_id: 'Qm',
      developer_address: '0xDEV',
      amount_grt: '100',
    });
    expect(out).toEqual({ id: 1, amount_grt: '100' });
    // dev addr lowercased, all optionals null
    expect(calls[0].values).toEqual([
      'Qm',
      null,
      '0xdev',
      '100',
      null,
      null,
      null,
      null,
    ]);
  });

  it('getBounty returns first row or null', async () => {
    const { getBounty } = await import('@/lib/studio/db');
    queueResults([{ id: 2 }]);
    expect(await getBounty(2)).toEqual({ id: 2 });
    queueResults([]);
    expect(await getBounty(404)).toBeNull();
  });

  it('updateBountyStatus sets claimed_at only when status is claimed', async () => {
    const { updateBountyStatus } = await import('@/lib/studio/db');
    await updateBountyStatus(1, 'claimed', '0xCLAIM');
    // [status, claimedBy(lower? no — not lowercased here), claimed_at ISO]
    expect(calls[0].values[0]).toBe('claimed');
    expect(calls[0].values[1]).toBe('0xCLAIM');
    expect(typeof calls[0].values[2]).toBe('string'); // ISO timestamp

    await updateBountyStatus(1, 'cancelled');
    // [status, claimedBy, claimed_at, id(WHERE)]
    expect(calls[1].values).toEqual(['cancelled', null, null, 1]);
  });

  it('listReconcilableBounties selects non-terminal on-chain bounties', async () => {
    const { listReconcilableBounties } = await import('@/lib/studio/db');
    queueResults([{ id: 1, status: 'open', chain_bounty_id: '5', claimed_by: null }]);
    const out = await listReconcilableBounties();
    expect(out).toHaveLength(1);
    expect(calls[0].text).toContain('chain_bounty_id IS NOT NULL');
  });
});

describe('studio/db — alerts', () => {
  it('createAlert lowercases owner and passes all fields', async () => {
    const { createAlert } = await import('@/lib/studio/db');
    queueResults([{ id: 1 }]);
    const out = await createAlert(
      '0xOWN',
      'Qmdep',
      'my alert',
      'https://hook',
      'discord',
      500,
    );
    expect(out).toEqual({ id: 1 });
    expect(calls[0].values).toEqual([
      '0xown',
      'Qmdep',
      'my alert',
      'https://hook',
      'discord',
      500,
    ]);
  });

  it('setAlertEnabled scopes to id + owner', async () => {
    const { setAlertEnabled } = await import('@/lib/studio/db');
    await setAlertEnabled(2, '0xOWN', false);
    expect(calls[0].values).toEqual([false, 2, '0xown']);
  });

  it('getAlert returns first row or null', async () => {
    const { getAlert } = await import('@/lib/studio/db');
    queueResults([{ id: 4 }]);
    expect(await getAlert(4, '0xOWN')).toEqual({ id: 4 });
    queueResults([]);
    expect(await getAlert(4, '0xOWN')).toBeNull();
  });

  it('recordAlertFire issues both an UPDATE and a log INSERT', async () => {
    const { recordAlertFire } = await import('@/lib/studio/db');
    await recordAlertFire(1, 'lagging', 'lag 600 blocks');
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain('UPDATE subgraph_alerts');
    expect(calls[1].text).toContain('INSERT INTO subgraph_alert_log');
    expect(calls[1].values).toEqual([1, 'lagging', 'lag 600 blocks']);
  });

  it('updateAlertStatus updates last_status without firing', async () => {
    const { updateAlertStatus } = await import('@/lib/studio/db');
    await updateAlertStatus(1, 'ok');
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('last_status');
    expect(calls[0].values).toEqual(['ok', 1]);
  });

  it('listEnabledAlerts is not owner-scoped', async () => {
    const { listEnabledAlerts } = await import('@/lib/studio/db');
    queueResults([{ id: 1, enabled: true }]);
    const out = await listEnabledAlerts();
    expect(out).toHaveLength(1);
    expect(calls[0].text).toContain('enabled = true');
    expect(calls[0].values).toEqual([]);
  });
});
