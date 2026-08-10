import { describe, expect, it } from "vitest";
import { POST } from "./route";

// Только валидация тела — до loadConfig() и до чтения шага.
const params = { params: Promise.resolve({ slug: "test-slug" }) };

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/lesson/test-slug/quiz", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/lesson/[slug]/quiz — валидация", () => {
  it("без stepId отвечает 400", async () => {
    const response = await POST(makeRequest({ questionIndex: 0, answerIndex: 0 }), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("stepId");
  });

  it("на нецелые номера отвечает 400", async () => {
    const response = await POST(
      makeRequest({ stepId: "005-check", questionIndex: "первый", answerIndex: 0 }),
      params,
    );
    expect(response.status).toBe(400);
  });

  it("на отрицательный номер варианта отвечает 400", async () => {
    const response = await POST(
      makeRequest({ stepId: "005-check", questionIndex: 0, answerIndex: -1 }),
      params,
    );
    expect(response.status).toBe(400);
  });
});
