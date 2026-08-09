import { describe, expect, it } from "vitest";
import { errorStatus } from "./error-message";

describe("errorStatus", () => {
  it("про лимит говорит про лимит, а не показывает сырое сообщение агента", () => {
    expect(errorStatus("limit", "Claude AI usage limit reached")).toMatch(/лимит подписки/);
  });

  it("про ненайденный CLI объясняет, что читать урок всё ещё можно", () => {
    const text = errorStatus("spawn", "spawn claude ENOENT");
    expect(text).toMatch(/не найден/);
    expect(text).toMatch(/читать урок/);
  });

  it("для прочих видов показывает сообщение как есть", () => {
    expect(errorStatus("agent", "агент вернул мусор")).toBe("Ошибка: агент вернул мусор");
    expect(errorStatus(undefined, "без вида")).toBe("Ошибка: без вида");
  });
});
