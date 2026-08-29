// Probing the nuthatch nests this dashboard sits on.
//
// Everything shipped on 29 August — the SQL surface, the named-query tier, the receipts those
// answers carry — runs on one box in Helsinki, alongside the delegation feed, developer activity,
// the DIPS panel and the Lodestar Oracle. Nothing watched it. If that box stopped, `/sql` would
// report every dataset unavailable, several panels would empty, and the first anyone would know is
// somebody mentioning it.
//
// That is the same failure that let three data services sit dead for 39 days, and adding public
// surfaces on top of an unwatched dependency made the blast radius larger rather than smaller.
//
// **Why `/ready` and not `/health`.** `/health` returns "ok" from a process that is running; it
// says nothing about whether that process is still indexing. A nest that answers instantly with
// three-week-old data is the quieter and more dangerous failure, because every page still renders
// and every number is simply wrong. `/ready` is the nest's own judgement: it 503s when quarantined
// or stalled and carries the block heights to explain itself. Asking the nest what it thinks beats
// inferring it from the outside.

const NUTHATCH_URL = process.env.NUTHATCH_URL?.replace(/\/$/, '');
const NUTHATCH_USER = process.env.NUTHATCH_USER;
const NUTHATCH_PASSWORD = process.env.NUTHATCH_PASSWORD;

export interface NestHealth {
  /** The dataset id from SQL_DATASETS, so an alert names something a reader can go and look at. */
  id: string;
  label: string;
  /** The nest's own verdict. False for unreachable, 503, or an unparseable answer. */
  ready: boolean;
  /** Why not, when the nest said. */
  reason?: string;
  /** Chain tip as the nest sees it. */
  tip?: number;
  /** Last block it has indexed. */
  lastBlock?: number;
  /** Blocks between the two, which is the number an operator actually reads. */
  lagBlocks?: number;
}

/**
 * `/ready` as the nest actually answers it, confirmed against a live nest rather than assumed:
 *
 * ```json
 * {"ready":true,"lag_blocks":2,"tip":499688638,"last_block":499688636,
 *  "sealed_through":499685543,"stalled":false,"wedged":false,"entities_stalled":false,
 *  "initial_poll_failed":false,"seconds_since_poll":0}
 * ```
 *
 * `quarantined`/`reason` appear only on the runtime-quarantine branch, which is why both are
 * optional and neither is relied on for the verdict.
 */
interface ReadyBody {
  ready?: boolean;
  lag_blocks?: number;
  tip?: number;
  last_block?: number;
  sealed_through?: number;
  stalled?: boolean;
  wedged?: boolean;
  entities_stalled?: boolean;
  initial_poll_failed?: boolean;
  seconds_since_poll?: number | null;
  quarantined?: boolean;
  reason?: string;
}

/**
 * Why a nest is not ready, in words an operator can act on.
 *
 * "not ready" is a status, not a diagnosis. The nest already distinguishes a failed first poll from
 * a wedged entity from a stalled cursor, and dropping that on the floor would turn four different
 * problems into one shrug.
 */
function explain(b: ReadyBody): string | undefined {
  if (b.quarantined) return `quarantined: ${b.reason ?? 'no reason given'}`;
  if (b.initial_poll_failed) return 'first poll failed: it has never reached the chain';
  if (b.wedged) return 'wedged';
  if (b.stalled) return 'stalled: it is running but no longer following the chain';
  if (b.entities_stalled) return 'a derived entity is stalled';
  return b.reason;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {};
  if (NUTHATCH_USER && NUTHATCH_PASSWORD) {
    h.Authorization = `Basic ${Buffer.from(`${NUTHATCH_USER}:${NUTHATCH_PASSWORD}`).toString('base64')}`;
  }
  return h;
}

/**
 * Ask one nest whether it is ready.
 *
 * A non-200 is not automatically a fault: `/ready` answers 503 *with a body* when it is stalled or
 * quarantined, and that body is the useful part. So the status is read for the verdict and the body
 * is read either way.
 */
export async function probeNest(
  id: string,
  label: string,
  basePath: string,
  timeoutMs = 8_000
): Promise<NestHealth> {
  if (!NUTHATCH_URL) return { id, label, ready: false, reason: 'no nuthatch origin configured' };

  try {
    const res = await fetch(`${NUTHATCH_URL}${basePath}/ready`, {
      headers: headers(),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => null)) as ReadyBody | null;

    if (!body) {
      return { id, label, ready: false, reason: `unreadable response (${res.status})` };
    }

    const tip = body.tip;
    const lastBlock = body.last_block;
    // The nest publishes `lag_blocks` itself. Preferring our own subtraction would be recomputing
    // a number the authority already has, and would disagree with it the moment either side of the
    // pair moved between the two readings.
    const lagBlocks =
      body.lag_blocks ??
      (tip != null && lastBlock != null ? Math.max(0, tip - lastBlock) : undefined);

    return {
      id,
      label,
      // Trust the nest's own flag when it gives one; fall back to the status code when it does not.
      ready: body.ready ?? res.ok,
      reason: explain(body),
      tip,
      lastBlock,
      lagBlocks: lagBlocks != null ? Math.max(0, lagBlocks) : undefined,
    };
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError';
    return { id, label, ready: false, reason: timedOut ? 'timed out' : 'unreachable' };
  }
}

/** Probe every dataset the public SQL surface exposes. */
export async function probeAllNests(
  datasets: { id: string; label: string; basePath: string }[]
): Promise<NestHealth[]> {
  return Promise.all(datasets.map((d) => probeNest(d.id, d.label, d.basePath)));
}

export function hasNestOrigin(): boolean {
  return Boolean(NUTHATCH_URL);
}
