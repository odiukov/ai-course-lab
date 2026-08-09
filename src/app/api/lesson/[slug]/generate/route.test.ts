import { describe, expect, it } from "vitest";
import { POST } from "./route";

// These only exercise the validation branch, which returns before
// loadConfig(), defaultDeps() and findLesson are reached — no filesystem
// config, no agent adapter, no server. A success-path case belongs to the
// manual Step 8 checks, not here: it would reach generateLessonPlan/
// ensureSteps and spawn the real agent CLI.
function makeRequest(from: string): Request {
  return new Request(`http://localhost/api/lesson/test-slug/generate?from=${encodeURIComponent(from)}`, {
    method: "POST",
  });
}

describe("POST /api/lesson/[slug]/generate — валидация from", () => {
  it.each(["-1", "1.5", "abc"])("отклоняет from=%s с 400 и понятным сообщением", async (from) => {
    const response = await POST(makeRequest(from), { params: Promise.resolve({ slug: "test-slug" }) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("from");
    expect(body.error).toContain(from);
  });
});
