/**
 * Foghorn client: fetchers through the /api/foghorn proxy, plus the presentation helpers.
 *
 * The fetchers are thin, which is the point: they must throw on a non-OK response rather than hand
 * back an empty shape, because every caller renders what it is given and an empty scorecard reads
 * as "this indexer is fine". The query-string builders are the other half worth pinning, since a
 * dropped parameter changes the question without changing the answer's appearance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchFoghornStats,
  fetchFoghornIndexers,
  fetchFoghornScorecard,
  fetchNeedsAttention,
  fetchDeploymentNames,
  fetchVerdicts,
  fetchSybilClusters,
  fetchFoghornFeed,
  fetchIndexerQuality,
  fetchDeploymentQos,
  fetchQosConflicts,
  fetchQosFees,
  fetchQosStatus,
  fetchQosBuckets,
  gradeVariant,
  severityVariant,
  scoreColor,
  kindLabel,
} from '../foghorn';

const fetchMock = vi.fn();

/** Answer every request with this body at this status. */
function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

const urlOf = (call = 0) => String(fetchMock.mock.calls[call][0]);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('foghornGet', () => {
  it('asks the proxy for JSON and returns the parsed body', async () => {
    respond({ total_probes: 7 });
    await expect(fetchFoghornStats()).resolves.toEqual({ total_probes: 7 });

    expect(urlOf()).toBe('/api/foghorn/stats');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Accept: 'application/json' },
    });
  });

  it.each([404, 502, 503, 500])('throws on %s rather than returning an empty shape', async (status) => {
    // A caller that got `{}` here would render a blank scorecard, which reads as "nothing wrong".
    respond({}, status);
    await expect(fetchFoghornStats()).rejects.toThrow(`Foghorn stats failed: ${status}`);
  });

  it('names the failing path in the error, so a log line says which call broke', async () => {
    respond({}, 502);
    await expect(fetchSybilClusters()).rejects.toThrow(/Foghorn sybil failed/);
  });
});

describe('query building', () => {
  it('defaults the indexers window, order and limit', async () => {
    respond({ indexers: [] });
    await fetchFoghornIndexers();
    expect(urlOf()).toBe('/api/foghorn/indexers?window=30&order=desc&limit=500');
  });

  it('passes explicit indexer parameters through', async () => {
    respond({ indexers: [] });
    await fetchFoghornIndexers(7, 'asc', 10);
    expect(urlOf()).toBe('/api/foghorn/indexers?window=7&order=asc&limit=10');
  });

  it('lower-cases an address before asking for a scorecard', async () => {
    // Addresses arrive checksummed from chain data; Foghorn keys on lowercase.
    respond({});
    await fetchFoghornScorecard('0xABCDEF1234567890ABCDEF1234567890ABCDEF12');
    expect(urlOf()).toBe(
      '/api/foghorn/indexer/0xabcdef1234567890abcdef1234567890abcdef12/scorecard',
    );
  });

  it('lower-cases an address for a quality lookup too', async () => {
    respond({});
    await fetchIndexerQuality('0xAAAA111122223333444455556666777788889999');
    expect(urlOf()).toContain('/indexer/0xaaaa111122223333444455556666777788889999/quality');
  });

  it('omits the attention kind when none is given', async () => {
    respond({ items: [], count: 0 });
    await fetchNeedsAttention();
    expect(urlOf()).toBe('/api/foghorn/needs-attention');
  });

  it('encodes an attention kind rather than splicing it in raw', async () => {
    respond({ items: [], count: 0 });
    await fetchNeedsAttention('serving bad/data');
    expect(urlOf()).toBe('/api/foghorn/needs-attention?kind=serving%20bad%2Fdata');
  });

  it('builds a verdicts query from only the parameters given', async () => {
    respond({ verdicts: [], count: 0 });
    await fetchVerdicts({ severity: 'critical', limit: 5 });

    const url = urlOf();
    expect(url).toContain('severity=critical');
    expect(url).toContain('limit=5');
    expect(url).not.toContain('kind=');
  });

  it('asks for verdicts with no query string when given nothing', async () => {
    respond({ verdicts: [], count: 0 });
    await fetchVerdicts();
    expect(urlOf()).toBe('/api/foghorn/verdicts');
  });

  it('defaults the feed, conflicts, fees and bucket windows', async () => {
    respond({});
    await fetchFoghornFeed();
    expect(urlOf(0)).toBe('/api/foghorn/feed?limit=50');

    await fetchQosConflicts();
    expect(urlOf(1)).toBe('/api/foghorn/qos/conflicts?days=7&limit=50');

    await fetchQosFees();
    expect(urlOf(2)).toBe('/api/foghorn/qos/fees?days=30&limit=200');

    await fetchQosBuckets();
    expect(urlOf(3)).toBe('/api/foghorn/qos/buckets?hours=24&limit=500');

    await fetchQosStatus();
    expect(urlOf(4)).toBe('/api/foghorn/qos/status');
  });

  it('encodes a deployment hash into the qos path', async () => {
    respond({ deployment_id: 'Qm', indexers: [] });
    await fetchDeploymentQos('QmDeploy1');
    expect(urlOf()).toContain('QmDeploy1');
  });
});

describe('fetchDeploymentNames', () => {
  it('does not call the API at all for an empty list', async () => {
    await expect(fetchDeploymentNames([])).resolves.toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the hashes and returns the name map', async () => {
    respond({ data: { QmA: 'Alpha' } });
    await expect(fetchDeploymentNames(['QmA'])).resolves.toEqual({ QmA: 'Alpha' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/subgraph-names');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ hashes: ['QmA'] });
  });

  it('degrades to an empty map when the route is unavailable', async () => {
    // Names are decoration; the surrounding table must still render. This is the one place a
    // silent empty is right, and it is why /api/subgraph-names may safely 503.
    respond({ error: 'No API key configured' }, 503);
    await expect(fetchDeploymentNames(['QmA'])).resolves.toEqual({});
  });

  it('tolerates a response with no data field', async () => {
    respond({});
    await expect(fetchDeploymentNames(['QmA'])).resolves.toEqual({});
  });
});

describe('presentation helpers', () => {
  it.each([
    ['A', 'success'],
    ['B', 'accent'],
    ['C', 'warning'],
    ['D', 'error'],
    ['F', 'error'],
    ['NR', 'default'],
    [null, 'default'],
    [undefined, 'default'],
  ])('grades %s as %s', (grade, expected) => {
    expect(gradeVariant(grade as string)).toBe(expected);
  });

  it.each([
    ['critical', 'error'],
    ['high', 'error'],
    ['medium', 'warning'],
    ['low', 'default'],
    ['nonsense', 'default'],
    [null, 'default'],
  ])('renders severity %s as %s', (severity, expected) => {
    expect(severityVariant(severity as string)).toBe(expected);
  });

  it.each([
    [100, 'var(--green)'],
    [75, 'var(--green)'],
    [74.9, 'var(--amber)'],
    [50, 'var(--amber)'],
    [49.9, 'var(--red)'],
    [0, 'var(--red)'],
  ])('colours a score of %s as %s', (score, expected) => {
    expect(scoreColor(score)).toBe(expected);
  });

  it('greys an absent score rather than colouring it as a bad one', () => {
    // Zero and "no score" are different claims, and red for both would assert the wrong one.
    expect(scoreColor(null)).toBe('var(--text-faint)');
    expect(scoreColor(undefined)).toBe('var(--text-faint)');
    expect(scoreColor(0)).toBe('var(--red)');
  });

  it('labels known verdict kinds and passes unknown ones through unchanged', () => {
    expect(kindLabel('serving-bad-data')).toBe('Serving bad data');
    expect(kindLabel('leech')).toBe('Leech');
    expect(kindLabel('sybil-swarm-member')).toBe('Sybil swarm member');
    // A new kind from Foghorn must still appear, rather than vanishing behind a blank.
    expect(kindLabel('some-new-kind')).toBe('some-new-kind');
  });
});
