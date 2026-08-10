import { describe, expect, it } from "vitest";
import { PUT } from "./route";

// Как и в остальных route-тестах проекта, проверяется только ветка валидации
// тела: она отвечает до loadConfig() и до любой записи на диск. Успешный путь
// покрыт тестами src/lib/exercise/file.test.ts и приёмкой руками.
const params = { params: Promise.resolve({ slug: "test-slug" }) };

function makeRequest(body: string): Request {
  return new Request("http://localhost/api/lesson/test-slug/exercise", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("PUT /api/lesson/[slug]/exercise — валидация", () => {
  it("без поля code отвечает 400", async () => {
    const response = await PUT(makeRequest(JSON.stringify({})), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("code");
  });

  it("на пустой код отвечает 400", async () => {
    const response = await PUT(makeRequest(JSON.stringify({ code: "  \n " })), params);
    expect(response.status).toBe(400);
  });

  it("на тело, которое не разбирается как JSON, отвечает 400, а не падает", async () => {
    const response = await PUT(makeRequest("{не json"), params);
    expect(response.status).toBe(400);
  });

  it("без mtimeMs отвечает 400: без него запись затирает чужую правку молча", async () => {
    const response = await PUT(makeRequest(JSON.stringify({ code: "x = 1\n" })), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("mtimeMs");
  });
});
