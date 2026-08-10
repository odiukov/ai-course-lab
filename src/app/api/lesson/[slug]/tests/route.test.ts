import { describe, expect, it } from "vitest";
import { isPassingRun, POST } from "./route";

// Только валидация тела: она отвечает до loadConfig(), до чтения шага и до
// спавна интерпретатора. Успешный путь — приёмка руками (Task 21).
const params = { params: Promise.resolve({ slug: "test-slug" }) };

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/lesson/test-slug/tests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/lesson/[slug]/tests — валидация", () => {
  it("без stepId отвечает 400", async () => {
    const response = await POST(makeRequest({}), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("stepId");
  });

  it("на сломанный JSON отвечает 400, а не падает", async () => {
    const broken = new Request("http://localhost/api/lesson/test-slug/tests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{не json",
    });
    expect((await POST(broken, params)).status).toBe(400);
  });
});

describe("isPassingRun", () => {
  it("все тесты прошли — зелёный", () => {
    expect(isPassingRun({ passed: 3, failed: 0, errors: 0 })).toBe(true);
  });

  it("часть тестов пропущена, но хотя бы один настоящий passed — зелёный", () => {
    expect(isPassingRun({ passed: 1, failed: 0, errors: 0 })).toBe(true);
  });

  it("все тесты пропущены, passed=0 — не зелёный: никто ничего не проверил", () => {
    expect(isPassingRun({ passed: 0, failed: 0, errors: 0 })).toBe(false);
  });

  it("есть падение — не зелёный", () => {
    expect(isPassingRun({ passed: 2, failed: 1, errors: 0 })).toBe(false);
  });
});
