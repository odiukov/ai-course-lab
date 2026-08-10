import { afterEach, describe, expect, it, vi } from "vitest";
import { LspClient, type LspSocket } from "./client";

class FakeSocket implements LspSocket {
  sent: unknown[] = [];
  closed = false;
  // Позволяет смоделировать InvalidStateError настоящего WebSocket: запись в
  // уже мёртвый сокет бросает синхронно, раньше, чем долетит событие close.
  sendThrows = false;
  private handlers = new Map<string, ((event: { data?: unknown }) => void)[]>();

  send(data: string) {
    if (this.sendThrows) throw new Error("сокет не в состоянии OPEN");
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  addEventListener(type: string, handler: (event: { data?: unknown }) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }
  fire(type: string, event: { data?: unknown } = {}) {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }
  reply(message: unknown) {
    this.fire("message", { data: JSON.stringify(message) });
  }
}

function makeClient(timeoutMs = 1000) {
  const socket = new FakeSocket();
  const client = new LspClient({ url: "ws://test", factory: () => socket, timeoutMs });
  return { socket, client };
}

// Гарантия на случай, если проверка внутри теста с фейковыми таймерами
// когда-нибудь упадёт раньше vi.useRealTimers(): afterEach срабатывает
// независимо от исхода теста, так что реальные таймеры не утекут в
// соседние тесты этого файла.
afterEach(() => {
  vi.useRealTimers();
});

describe("LspClient", () => {
  it("до открытия соединения сообщения ждут, а не теряются", async () => {
    const { socket, client } = makeClient();
    const started = client.start({ rootUri: "file:///tmp/p", folderName: "p" });

    expect(socket.sent).toEqual([]);
    socket.fire("open");
    expect((socket.sent[0] as { method: string }).method).toBe("initialize");

    socket.reply({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } });
    await started;
    expect((socket.sent[1] as { method: string }).method).toBe("initialized");
  });

  it("ответ находит свой запрос по id", async () => {
    const { socket, client } = makeClient();
    socket.fire("open");
    const pending = client.request<{ items: string[] }>("textDocument/completion", { a: 1 });
    const sent = socket.sent.at(-1) as { id: number };

    socket.reply({ jsonrpc: "2.0", id: sent.id, result: { items: ["transpose"] } });
    expect(await pending).toEqual({ items: ["transpose"] });
  });

  it("ошибка от сервера отклоняет именно этот запрос", async () => {
    const { socket, client } = makeClient();
    socket.fire("open");
    const pending = client.request("textDocument/hover", {});
    const sent = socket.sent.at(-1) as { id: number };
    socket.reply({ jsonrpc: "2.0", id: sent.id, error: { code: -32601, message: "нет метода" } });
    await expect(pending).rejects.toThrow(/нет метода/);
  });

  it("запрос без ответа отклоняется по таймауту, а не висит навсегда", async () => {
    vi.useFakeTimers();
    const { socket, client } = makeClient(50);
    socket.fire("open");
    const pending = client.request("textDocument/hover", {});
    vi.advanceTimersByTime(60);
    await expect(pending).rejects.toThrow(/не ответил/);
  });

  it("publishDiagnostics уходит подписчику", () => {
    const { socket, client } = makeClient();
    const seen: unknown[] = [];
    client.onDiagnostics((params) => seen.push(params));
    socket.fire("open");
    socket.reply({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri: "file:///tmp/p/exercise.py", diagnostics: [{ message: "боль" }] },
    });
    expect(seen).toEqual([{ uri: "file:///tmp/p/exercise.py", diagnostics: [{ message: "боль" }] }]);
  });

  it("publishDiagnostics без params не долетает до подписчика", () => {
    const { socket, client } = makeClient();
    const seen: unknown[] = [];
    client.onDiagnostics((params) => seen.push(params));
    socket.fire("open");
    socket.reply({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics" });
    expect(seen).toEqual([]);
  });

  it("didOpen и didChange уходят уведомлениями, без id", () => {
    const { socket, client } = makeClient();
    socket.fire("open");
    client.didOpen("file:///tmp/p/exercise.py", "pass", 1);
    client.didChange("file:///tmp/p/exercise.py", "pass\n", 2);

    const [open, change] = socket.sent as { method: string; id?: number; params: unknown }[];
    expect(open.method).toBe("textDocument/didOpen");
    expect(open.id).toBeUndefined();
    expect(change.method).toBe("textDocument/didChange");
  });

  it("dispose закрывает сокет и отклоняет висящие запросы", async () => {
    const { socket, client } = makeClient();
    socket.fire("open");
    const pending = client.request("textDocument/hover", {});
    client.dispose();
    expect(socket.closed).toBe(true);
    await expect(pending).rejects.toThrow(/закрыт/);
  });

  it("didChange после обрыва соединения не бросает и не уходит в сокет", () => {
    const { socket, client } = makeClient();
    socket.fire("open");
    socket.fire("close");
    const before = socket.sent.length;

    expect(() => client.didChange("file:///tmp/p/exercise.py", "pass\n", 2)).not.toThrow();
    expect(socket.sent.length).toBe(before);
  });

  it("didChange после dispose не бросает и не уходит в сокет", () => {
    const { socket, client } = makeClient();
    socket.fire("open");
    client.dispose();
    const before = socket.sent.length;

    expect(() => client.didChange("file:///tmp/p/exercise.py", "pass\n", 2)).not.toThrow();
    expect(socket.sent.length).toBe(before);
  });

  it("синхронный бросок из socket.send не долетает до вызывающего и рвёт висящие запросы", async () => {
    const { socket, client } = makeClient();
    socket.fire("open");
    socket.sendThrows = true;

    const pending = client.request("textDocument/hover", {});
    expect(socket.sent).toEqual([]);
    await expect(pending).rejects.toThrow(/закрыто/);
  });
});
