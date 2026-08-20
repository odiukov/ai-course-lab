import { describe, expect, it } from "vitest";
import { errorStatus, isLimitError, isTimeoutError, isTransientError } from "./error-message";

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

describe("isLimitError", () => {
  it("узнаёт лимит по kind, который ставит runner", () => {
    expect(isLimitError(Object.assign(new Error("что угодно"), { kind: "limit" }))).toBe(true);
  });

  // CLI сообщает про лимит трат обычным error-кадром: kind у него "agent",
  // и без разбора текста очередь фаз прогорела бы вхолостую.
  it("узнаёт лимит по тексту CLI, у которого kind не тот", () => {
    const error = Object.assign(
      new Error("You've hit your individual spend limit · run /usage-credits to ask your admin"),
      { kind: "agent" },
    );
    expect(isLimitError(error)).toBe(true);
  });

  it("не принимает за лимит таймаут и прочие поломки", () => {
    expect(isLimitError(Object.assign(new Error("claude не ответил за 600 с"), { kind: "timeout" }))).toBe(false);
    expect(isLimitError(new Error("план не разобрался"))).toBe(false);
    expect(isLimitError(null)).toBe(false);
    expect(isLimitError("строка")).toBe(false);
  });
});

describe("isTimeoutError", () => {
  it("узнаёт таймаут по kind и по тексту runner-а", () => {
    expect(isTimeoutError(Object.assign(new Error("x"), { kind: "timeout" }))).toBe(true);
    expect(isTimeoutError(new Error("claude не ответил за 600 с — запуск прерван"))).toBe(true);
  });

  it("не путает таймаут с лимитом и прочим", () => {
    expect(isTimeoutError(Object.assign(new Error("spend limit"), { kind: "agent" }))).toBe(false);
    expect(isTimeoutError(new Error("план не разобрался"))).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
  });
});

describe("isTransientError", () => {
  it("узнаёт перегруз провайдера и обрыв потока", () => {
    expect(isTransientError(new Error("API Error: 529 Overloaded. This is a server-side issue"))).toBe(true);
    expect(isTransientError(new Error("API Error: The response stopped arriving."))).toBe(true);
  });

  // Лимит по тексту тоже похож на временную беду, но повтор его не лечит:
  // очередь обязана встать, а не молотить впустую.
  it("не считает временным исчерпанный лимит", () => {
    expect(isTransientError(new Error("You've hit your individual spend limit · run /usage-credits"))).toBe(false);
  });

  it("не считает временным разбор плана и таймаут", () => {
    expect(isTransientError(new Error("Не удалось получить валидный план урока"))).toBe(false);
    expect(isTransientError(Object.assign(new Error("не ответил за 600 с"), { kind: "timeout" }))).toBe(false);
  });
});
