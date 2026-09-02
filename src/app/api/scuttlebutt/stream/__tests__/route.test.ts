/**
 * GET /api/scuttlebutt/stream — the Server-Sent Events feed behind the message board.
 *
 * A stream fails quietly by construction: the client stays connected, sees nothing, and concludes
 * the room is empty. So the things worth pinning are the ones whose failure looks like silence:
 *
 *  - the `Last-Event-ID` replay. It is the only thing covering a reconnect gap, and a client that
 *    reconnects mid-conversation and is served nothing has lost those messages for good.
 *  - the `id:` line on each replayed and each live event. Without it the browser sends no
 *    `Last-Event-ID` next time, and the replay above never happens at all.
 *  - the heartbeat. Intermediaries close an idle connection, and a stream that is only silent
 *    because nobody is talking looks identical to one that has been cut.
 *  - the teardown on abort, because a Redis subscriber that is never quit is a leak per reader.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.fn();
let dbPresent = true;
vi.mock('@/lib/db', () => ({
  get db() {
    return dbPresent ? (...a: unknown[]) => db(...a) : null;
  },
}));

const createRedisSubscriber = vi.fn();
vi.mock('@/lib/cache', () => ({
  createRedisSubscriber: () => createRedisSubscriber(),
}));
vi.mock('@/lib/scuttlebutt', () => ({ SB_ROOM: 'main', SB_CHANNEL: 'sb:main' }));

import { GET } from '../route';

/** A stand-in for the ioredis subscriber, with a hook to fire a published message. */
function fakeSubscriber() {
  const handlers: ((channel: string, message: string) => void)[] = [];
  return {
    on: vi.fn((event: string, fn: (c: string, m: string) => void) => {
      if (event === 'message') handlers.push(fn);
    }),
    subscribe: vi.fn(async () => undefined),
    quit: vi.fn(async () => undefined),
    publish: (message: string) => handlers.forEach((h) => h('sb:main', message)),
  };
}

function request(lastEventId?: string, signal?: AbortSignal) {
  const headers = new Headers();
  if (lastEventId !== undefined) headers.set('last-event-id', lastEventId);
  return new NextRequest('http://localhost/api/scuttlebutt/stream', { headers, signal });
}

/** Drain whatever is already queued on the stream, without blocking on the next chunk. */
async function drain(res: Response, expected = 1): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (let i = 0; i < expected; i++) {
    const next = await Promise.race([
      reader.read(),
      new Promise<null>((r) => setTimeout(() => r(null), 0)),
    ]);
    if (!next || next.done) break;
    out += decoder.decode(next.value);
  }
  reader.releaseLock();
  return out;
}

let sub: ReturnType<typeof fakeSubscriber>;

beforeEach(() => {
  vi.clearAllMocks();
  dbPresent = true;
  sub = fakeSubscriber();
  createRedisSubscriber.mockResolvedValue(sub);
  db.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the response envelope', () => {
  it('is an event-stream that must not be cached or transformed', async () => {
    const res = await GET(request());
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    // `no-transform` matters as much as `no-cache`: a proxy that buffers to compress
    // holds every event until the stream ends, which is the whole point of it not ending.
    expect(res.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(res.headers.get('Connection')).toBe('keep-alive');
  });
});

describe('the Last-Event-ID replay', () => {
  it('replays the messages after the given id, each carrying its own id line', async () => {
    db.mockResolvedValue([
      { id: 8, room: 'main', name: 'a', tripcode: null, body: 'one', created_at: 'T' },
      { id: 9, room: 'main', name: 'b', tripcode: null, body: 'two', created_at: 'T' },
    ]);

    const out = await drain(await GET(request('7')), 2);

    expect(out).toContain('id: 8\n');
    expect(out).toContain('id: 9\n');
    expect(out).toContain('"body":"one"');
    expect(out).toContain('"type":"message"');
  });

  it('does not query at all without a Last-Event-ID', async () => {
    await drain(await GET(request()));
    expect(db).not.toHaveBeenCalled();
  });

  it('ignores a Last-Event-ID that is not a number', async () => {
    await drain(await GET(request('not-a-number')));
    expect(db).not.toHaveBeenCalled();
  });

  it('skips the replay when there is no database', async () => {
    dbPresent = false;
    const res = await GET(request('7'));
    expect(res.status).toBe(200);
    expect(db).not.toHaveBeenCalled();
  });

  it('keeps the stream open when the replay query fails', async () => {
    // Best-effort: losing the backlog is bad, losing the live feed with it is worse.
    db.mockRejectedValue(new Error('connection reset'));
    const res = await GET(request('7'));

    sub.publish(JSON.stringify({ type: 'message', message: { id: 10, body: 'live' } }));
    const out = await drain(res, 1);
    expect(out).toContain('"body":"live"');
  });
});

describe('the live feed', () => {
  it('subscribes to the room channel', async () => {
    await drain(await GET(request()));
    expect(sub.subscribe).toHaveBeenCalledWith('sb:main');
  });

  it('forwards a published message with its id', async () => {
    const res = await GET(request());
    sub.publish(JSON.stringify({ type: 'message', message: { id: 42, body: 'hello' } }));

    const out = await drain(res, 1);
    expect(out).toBe(`id: 42\ndata: {"type":"message","message":{"id":42,"body":"hello"}}\n\n`);
  });

  it('forwards a payload it cannot parse, without an id line', async () => {
    const res = await GET(request());
    sub.publish('not json at all');

    const out = await drain(res, 1);
    expect(out).toBe('data: not json at all\n\n');
  });

  it('omits the id line for an event that carries no numeric message id', async () => {
    // A deletion event has no `message.id`; inventing one would corrupt the client's cursor.
    const res = await GET(request());
    sub.publish(JSON.stringify({ type: 'delete', id: 42 }));

    const out = await drain(res, 1);
    expect(out.startsWith('data: ')).toBe(true);
  });

  it('still serves a stream when Redis is unavailable', async () => {
    createRedisSubscriber.mockResolvedValue(null);
    db.mockResolvedValue([{ id: 3, room: 'main', name: 'a', tripcode: null, body: 'x', created_at: 'T' }]);

    const out = await drain(await GET(request('2')), 1);
    expect(out).toContain('id: 3\n');
  });
});

describe('the heartbeat and teardown', () => {
  it('emits a comment line on the 15-second timer', async () => {
    vi.useFakeTimers();
    const res = await GET(request());
    await vi.advanceTimersByTimeAsync(15_000);

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe(': ping\n\n');
    reader.releaseLock();
  });

  it('quits the subscriber and stops the heartbeat when the client goes away', async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    await GET(request(undefined, ac.signal));

    ac.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(sub.quit).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    // The interval is cleared, so no further work is scheduled against a closed controller.
    expect(sub.quit).toHaveBeenCalledTimes(1);
  });

  it('survives a subscriber that throws on quit', async () => {
    sub.quit.mockRejectedValue(new Error('already closed'));
    const ac = new AbortController();
    await GET(request(undefined, ac.signal));

    ac.abort();
    await new Promise((r) => setTimeout(r, 0));
    expect(sub.quit).toHaveBeenCalled();
  });
});
