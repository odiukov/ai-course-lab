import { describe, expect, it } from "vitest";
import { sseStream, type SendEvent } from "./sse";

async function readAll(response: Response): Promise<string> {
  return await response.text();
}

describe("sseStream", () => {
  it("шлёт события и закрывает поток", async () => {
    const response = sseStream(async (send) => {
      send("progress", { text: "раз" });
      send("done", { ids: ["001-t"] });
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await readAll(response);
    expect(body).toContain("event: progress");
    expect(body).toContain('"text":"раз"');
    expect(body).toContain("event: done");
  });

  it("превращает исключение в событие error", async () => {
    const response = sseStream(async () => {
      throw new Error("всё сломалось");
    });
    expect(await readAll(response)).toContain("всё сломалось");
  });

  it("добавляет kind в событие error, если он есть у ошибки", async () => {
    const response = sseStream(async () => {
      const error = new Error("упёрлись в лимит") as Error & { kind: string };
      error.kind = "limit";
      throw error;
    });
    const body = await readAll(response);
    expect(body).toContain("event: error");
    expect(body).toContain('"message":"упёрлись в лимит"');
    expect(body).toContain('"kind":"limit"');
  });

  it("не падает, если писать после того, как клиент отвалился", async () => {
    // Ровно сценарий закрытой вкладки: контроллер уже закрыт, а обработчик
    // ещё шлёт прогресс, потом падает, и sseStream шлёт error и close.
    let sendAfterClose: SendEvent | null = null;
    const response = sseStream(async (send) => {
      sendAfterClose = send;
      send("progress", { text: "до отмены" });
      throw new Error("агент упал уже после отключения клиента");
    });

    await response.body!.cancel();
    // Обработчик успел или не успел — в любом случае повторная запись после
    // закрытия не должна выбрасывать.
    expect(() => sendAfterClose?.("progress", { text: "после отмены" })).not.toThrow();
  });

  it("повторный send после закрытия потока молчит, а не выбрасывает", async () => {
    let captured: SendEvent | null = null;
    const response = sseStream(async (send) => {
      captured = send;
      send("done", { ids: [] });
    });
    await readAll(response);

    expect(() => captured?.("progress", { text: "поздно" })).not.toThrow();
  });

  it("не добавляет kind для обычной ошибки без этого поля", async () => {
    const response = sseStream(async () => {
      throw new Error("обычная ошибка");
    });
    const body = await readAll(response);
    expect(body).toContain("event: error");
    expect(body).toContain('"message":"обычная ошибка"');
    expect(body).not.toContain("kind");
  });
});
