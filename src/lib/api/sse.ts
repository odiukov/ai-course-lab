export type SendEvent = (event: string, data: unknown) => void;

export function sseStream(handler: (send: SendEvent) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Once the client disconnects, the controller is closed and every
      // enqueue throws. Unguarded, that turned one abandoned request into
      // three throws: enqueue in `send`, `send` again from the catch, and
      // `close` in the finally — an unhandled rejection each time.
      let closed = false;

      const send: SendEvent = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        await handler(send);
      } catch (error) {
        const kind = (error as { kind?: unknown }).kind;
        send("error", {
          message: (error as Error).message,
          ...(typeof kind === "string" ? { kind } : {}),
        });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed by the runtime after the client went away.
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
