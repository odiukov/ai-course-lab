import { describe, expect, it } from "vitest";
import { PUT } from "./route";

// Как и в остальных route-тестах проекта, проверяется ветка валидации тела:
// она отвечает до loadConfig() и до открытия базы. Само чтение и запись
// покрыты в src/lib/progress/settings.test.ts.
function makeRequest(body: string): Request {
  return new Request("http://localhost/api/settings/agent", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("PUT /api/settings/agent — валидация", () => {
  it("без поля agent отвечает 400", async () => {
    const response = await PUT(makeRequest(JSON.stringify({})));
    expect(response.status).toBe(400);
  });

  it("на неизвестного агента отвечает 400", async () => {
    const response = await PUT(makeRequest(JSON.stringify({ agent: "gpt" })));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("claude");
  });

  it("на тело, которое не разбирается как JSON, отвечает 400, а не падает", async () => {
    const response = await PUT(makeRequest("{не json"));
    expect(response.status).toBe(400);
  });
});
