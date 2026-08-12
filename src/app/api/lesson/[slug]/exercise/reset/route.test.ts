import { describe, expect, it } from "vitest";
import { POST } from "./route";

// Как и в остальных route-тестах проекта, проверяется только ветка валидации:
// она отвечает до loadConfig() и до любого чтения/записи на диск. Сам сброс
// покрыт src/lib/exercise/reset.test.ts.
const params = { params: Promise.resolve({ slug: "test-slug" }) };

function postRequest(body: string): Request {
  return new Request("http://localhost/api/lesson/test-slug/exercise/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("POST /api/lesson/[slug]/exercise/reset — валидация", () => {
  it("без поля fn отвечает 400", async () => {
    const response = await POST(postRequest(JSON.stringify({})), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("функция");
  });

  it("на пустой fn отвечает 400", async () => {
    const response = await POST(postRequest(JSON.stringify({ fn: "  " })), params);
    expect(response.status).toBe(400);
  });

  it("на тело, которое не разбирается как JSON, отвечает 400, а не падает", async () => {
    const response = await POST(postRequest("{не json"), params);
    expect(response.status).toBe(400);
  });
});
