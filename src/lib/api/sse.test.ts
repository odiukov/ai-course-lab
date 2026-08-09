import { describe, expect, it } from "vitest";
import { sseStream } from "./sse";

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
