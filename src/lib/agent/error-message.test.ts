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

  it("про таймаут говорит, что запуск прерван, и зовёт повторить", () => {
    const text = errorStatus("timeout", "claude не ответил за 600 с — запуск прерван");
    expect(text).toMatch(/не ответил вовремя/);
    expect(text).toMatch(/Попробуй ещё раз/);
  });

  it("про отмену говорит про отмену, не называя генерацию", () => {
    // Тот же текст показывает панель чата, поэтому «Генерация отменена» была бы
    // враньём в половине случаев.
    const text = errorStatus("aborted", "Запуск claude отменён");
    expect(text).toMatch(/тменён/);
    expect(text).not.toMatch(/енерация/);
  });

  it("для прочих видов показывает сообщение как есть", () => {
    expect(errorStatus("agent", "агент вернул мусор")).toBe("Ошибка: агент вернул мусор");
    expect(errorStatus(undefined, "без вида")).toBe("Ошибка: без вида");
  });
});
