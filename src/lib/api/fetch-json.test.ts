import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "./fetch-json";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function respondWith(response: Response | Error) {
  globalThis.fetch = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  ) as unknown as typeof fetch;
}

describe("fetchJson", () => {
  it("отдаёт разобранное тело на успешный ответ", async () => {
    respondWith(Response.json({ mtimeMs: 42 }));
    const result = await fetchJson<{ mtimeMs: number }>("/api/x");
    expect(result).toMatchObject({ ok: true, status: 200, data: { mtimeMs: 42 } });
  });

  it("сообщение об ошибке берёт из поля error тела", async () => {
    respondWith(Response.json({ error: "Пустой код — запись отклонена" }, { status: 400 }));
    const result = await fetchJson("/api/x");
    expect(result).toMatchObject({ ok: false, status: 400 });
    if (result.ok) throw new Error("ожидалась неудача");
    expect(result.error).toContain("Пустой код");
  });

  it("тело неудачи доступно вызывающему: 409 несёт актуальный файл", async () => {
    respondWith(
      Response.json({ error: "изменился", current: { code: "x = 1\n", mtimeMs: 7 } }, { status: 409 }),
    );
    const result = await fetchJson("/api/x", { method: "PUT" });
    if (result.ok) throw new Error("ожидалась неудача");
    expect(result.status).toBe(409);
    expect((result.data as { current: { mtimeMs: number } }).current.mtimeMs).toBe(7);
  });

  it("HTML вместо JSON — это неудача, а не необработанный reject", async () => {
    respondWith(new Response("<html>500</html>", { headers: { "content-type": "text/html" } }));
    const result = await fetchJson("/api/x");
    if (result.ok) throw new Error("ожидалась неудача");
    expect(result.error).toMatch(/не разобрался как JSON/);
  });

  it("упавшая сеть — тоже значение", async () => {
    respondWith(new TypeError("Failed to fetch"));
    const result = await fetchJson("/api/x");
    if (result.ok) throw new Error("ожидалась неудача");
    expect(result.status).toBe(0);
    expect(result.error).toContain("Сервер не ответил");
  });
});
