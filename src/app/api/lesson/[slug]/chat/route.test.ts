import { describe, expect, it } from "vitest";
import { POST } from "./route";

// Проверяется только ветка валидации тела: она возвращает ответ до loadConfig(),
// до чтения плана и до defaultDeps, поэтому ни файловой системы, ни агента здесь
// не появляется. Успешный путь спавнил бы настоящий CLI и проверяется руками в
// Task 17.
function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/lesson/test-slug/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ slug: "test-slug" }) };

describe("POST /api/lesson/[slug]/chat — валидация", () => {
  it("без stepId отвечает 400", async () => {
    const response = await POST(makeRequest({ question: "почему?" }), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("stepId");
  });

  it("на пустой вопрос отвечает 400", async () => {
    const response = await POST(makeRequest({ stepId: "003-t", question: "   " }), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Пустой вопрос");
  });

  it("на слишком длинный вопрос отвечает 400", async () => {
    const response = await POST(
      makeRequest({ stepId: "003-t", question: "я".repeat(2001) }),
      params,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("2000");
  });

  it("на тело, которое не разбирается как JSON, отвечает 400, а не падает", async () => {
    const broken = new Request("http://localhost/api/lesson/test-slug/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{не json",
    });
    const response = await POST(broken, params);
    expect(response.status).toBe(400);
  });
});
