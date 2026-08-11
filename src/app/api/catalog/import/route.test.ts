import { describe, expect, it } from "vitest";
import { POST } from "./route";

// Как и в остальных route-тестах проекта, проверяется ветка валидации тела:
// она отвечает до loadConfig() и до любого обращения к диску и сети. Выбор
// режима, откат на COURSE_REPO и коды 404/503 покрыты в
// src/lib/source/import-request.test.ts.
function makeRequest(body: string): Request {
  return new Request("http://localhost/api/catalog/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("POST /api/catalog/import — валидация", () => {
  it("без слага отвечает 400", async () => {
    const response = await POST(makeRequest(JSON.stringify({})));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("слаг");
  });

  it("на пустой слаг отвечает 400", async () => {
    const response = await POST(makeRequest(JSON.stringify({ slug: "   " })));
    expect(response.status).toBe(400);
  });

  it("на тело, которое не разбирается как JSON, отвечает 400, а не падает", async () => {
    const response = await POST(makeRequest("{не json"));
    expect(response.status).toBe(400);
  });
});
