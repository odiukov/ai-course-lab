import { describe, expect, it } from "vitest";
import { POST } from "./route";

// Как и в чате: проверяется только ветка валидации, которая отвечает до
// loadConfig() и до записи на диск.
function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/lesson/test-slug/clarifications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ slug: "test-slug" }) };

describe("POST /api/lesson/[slug]/clarifications — валидация", () => {
  it("без stepId отвечает 400", async () => {
    const response = await POST(makeRequest({ question: "в", answer: "о" }), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("stepId");
  });

  it("без вопроса отвечает 400", async () => {
    const response = await POST(makeRequest({ stepId: "003-t", answer: "о" }), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("вопрос");
  });

  it("без ответа отвечает 400", async () => {
    const response = await POST(makeRequest({ stepId: "003-t", question: "в" }), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("ответ");
  });
});
