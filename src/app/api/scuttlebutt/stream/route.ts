import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { createRedisSubscriber } from '@/lib/cache';
import { SB_ROOM, SB_CHANNEL } from '@/lib/scuttlebutt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel caps function duration; EventSource reconnects automatically and
// `Last-Event-ID` replay covers the gap, so a finite stream is fine.
export const maxDuration = 300;

// GET — Server-Sent Events stream of new/deleted messages.
export async function GET(req: NextRequest) {
  const lastEventId = req.headers.get('last-event-id');
  const encoder = new TextEncoder();
  const sub = await createRedisSubscriber();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const enqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (data: string, id?: number) => {
        const idLine = id !== undefined ? `id: ${id}\n` : '';
        enqueue(`${idLine}data: ${data}\n\n`);
      };

      // Replay messages missed during a reconnect gap.
      if (lastEventId && db) {
        const since = parseInt(lastEventId, 10);
        if (!isNaN(since)) {
          try {
            const rows = await db`
              SELECT id, room, name, tripcode, body, created_at
              FROM scuttlebutt_messages
              WHERE room = ${SB_ROOM} AND id > ${since} AND deleted = false
              ORDER BY id ASC LIMIT 200`;
            for (const r of rows) {
              send(JSON.stringify({ type: 'message', message: r }), r.id as number);
            }
          } catch {
            /* best-effort replay */
          }
        }
      }

      if (sub) {
        sub.on('message', (_channel: string, message: string) => {
          let id: number | undefined;
          try {
            const evt = JSON.parse(message);
            if (evt?.type === 'message' && typeof evt.message?.id === 'number') {
              id = evt.message.id;
            }
          } catch {
            /* forward raw */
          }
          send(message, id);
        });
        await sub.subscribe(SB_CHANNEL);
      }

      // Heartbeat comment keeps intermediaries from closing an idle stream.
      const heartbeat = setInterval(() => enqueue(': ping\n\n'), 15_000);

      const close = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        if (sub) {
          try {
            await sub.quit();
          } catch {
            /* noop */
          }
        }
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };
      req.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
