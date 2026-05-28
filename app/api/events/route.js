import { addClient, removeClient } from '@/src/lib/events';

export const dynamic = 'force-dynamic';

export function GET(request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const encode = (s) => encoder.encode(s);

      addClient(controller);
      controller.enqueue(encode('data: connected\n\n'));

      // Ping a cada 25s para manter a ligação viva
      const ping = setInterval(() => {
        try { controller.enqueue(encode('data: ping\n\n')); }
        catch { clearInterval(ping); }
      }, 25000);

      request.signal.addEventListener('abort', () => {
        clearInterval(ping);
        removeClient(controller);
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
