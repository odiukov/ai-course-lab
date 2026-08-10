import { describe, expect, it } from "vitest";
import { POST } from "./route";

// Только валидация тела: отвечает до loadConfig(), до замера и до агента.
const params = { params: Promise.resolve({ slug: "test-slug" }) };

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/lesson/test-slug/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/lesson/[slug]/review — валидация", () => {
  it("без stepId отвечает 400", async () => {
    const response = await POST(makeRequest({}), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("stepId");
  });

  it("на сломанный JSON отвечает 400", async () => {
    const broken = new Request("http://localhost/api/lesson/test-slug/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{не json",
    });
    expect((await POST(broken, params)).status).toBe(400);
  });
});
