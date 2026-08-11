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

describe("GET /api/visual — CSP", () => {
  // Заголовок — единственное, что не пускает скрипт схемы в сеть:
  // sandbox="allow-scripts" её не режет, а прямой ссылкой схема открывается
  // вообще не в iframe. Проверяется на пришедшей с курсом схеме, потому что
  // она лежит в репозитории; ставится он на оба пространства имён сразу.
  it("отдаёт схему с default-src 'none' и разрешением только на свой inline", async () => {
    const response = await GET(get("path=learning-visuals/lesson-02-shapes.html"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
    );
  });
});
