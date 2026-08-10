import { describe, expect, it } from "vitest";
import { POST } from "./route";

// Только ветка валидации: она отвечает до loadConfig() и до открытия базы.
function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/lesson/test-slug/progress", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ slug: "test-slug" }) };

describe("POST /api/lesson/[slug]/progress — валидация", () => {
  it("без stepId отвечает 400", async () => {
    const response = await POST(makeRequest({ event: "read" }), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("stepId");
  });

  it("на неизвестное событие отвечает 400", async () => {
    const response = await POST(makeRequest({ stepId: "003-t", event: "почитал" }), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("event");
  });
});
