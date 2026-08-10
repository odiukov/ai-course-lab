import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";

// Как и в остальных route-тестах проекта, проверяется только ветка валидации:
// она отвечает до loadConfig() и до любого чтения/записи на диск. Путь с
// найденным/не найденным упражнением покрыт tests src/lib/exercise/recall.test.ts
// и приёмкой руками (findLesson/findExercise читают настоящий source/).
const params = { params: Promise.resolve({ slug: "test-slug" }) };

function getRequest(query: string): Request {
  return new Request(`http://localhost/api/lesson/test-slug/recall${query}`);
}

function postRequest(body: string): Request {
  return new Request("http://localhost/api/lesson/test-slug/recall", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("GET /api/lesson/[slug]/recall — валидация", () => {
  it("без ?fn отвечает 400", async () => {
    const response = await GET(getRequest(""), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("функция");
  });

  it("на пустой ?fn=  отвечает 400", async () => {
    const response = await GET(getRequest("?fn=%20%20"), params);
    expect(response.status).toBe(400);
  });
});

describe("POST /api/lesson/[slug]/recall — валидация", () => {
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
