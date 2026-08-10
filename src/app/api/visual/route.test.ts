import { describe, expect, it } from "vitest";
import { GET } from "./route";

// Ветка адресации: `lesson`+`step` уходят в резолвер сгенерированных схем,
// одинокий `lesson` или `step` — ошибка запроса, а не поиск по `path`.
// Успешный путь тут не проверить: он требует урока на диске в contentDir.
function get(query: string): Request {
  return new Request(`http://localhost/api/visual?${query}`);
}

describe("GET /api/visual — адресация", () => {
  it("404 на пару lesson+step, которой нет на диске", async () => {
    const response = await GET(get("lesson=01-math-foundations__02-beta&step=004-dlina"));
    expect(response.status).toBe(404);
  });

  it.each(["lesson=01-math-foundations__02-beta", "step=004-dlina"])(
    "400 на неполную пару (%s)",
    async (query) => {
      const response = await GET(get(query));
      expect(response.status).toBe(400);
    },
  );

  it("400 на путь за пределами learning-visuals", async () => {
    const response = await GET(get("path=../secret.html"));
    expect(response.status).toBe(400);
  });
});
