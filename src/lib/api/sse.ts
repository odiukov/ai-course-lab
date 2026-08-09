export type SendEvent = (event: string, data: unknown) => void;

export function sseStream(handler: (send: SendEvent) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send: SendEvent = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
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
        controller.close();
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
