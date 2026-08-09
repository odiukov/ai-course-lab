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
});
