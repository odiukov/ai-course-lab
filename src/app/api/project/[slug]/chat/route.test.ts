import { describe, expect, it } from "vitest";
import { POST } from "./route";

const params = { params: Promise.resolve({ slug: "19-capstone-projects__01-terminal-agent" }) };

function request(body: unknown): Request {
  return new Request("http://localhost/api/project/example/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/project/[slug]/chat — валидация", () => {
  it("требует milestone id", async () => {
    const response = await POST(request({ question: "Что это?" }), params);
    expect(response.status).toBe(400);
  });

  it("не принимает пустой вопрос", async () => {
    const response = await POST(request({ stepId: "m01-loop", question: "  " }), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Пустой вопрос");
  });
});
