import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openProgressDb } from "./db";
import {
  addChatMessage,
  findChatSession,
  formatHistory,
  markMessageKept,
  MAX_HISTORY_CHARS,
  openChatSession,
  readChatSession,
  recentHistory,
} from "./chat";

const SLUG = "01-math-foundations__02-beta";

function freshDb() {
  const dataDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "chat-db-")), "data");
  return openProgressDb(dataDir);
}

describe("openChatSession", () => {
  it("переиспользует сессию того же шага", () => {
    const db = freshDb();
    const first = openChatSession(db, SLUG, "003-t");
    const second = openChatSession(db, SLUG, "003-t");
    expect(second).toBe(first);
  });

  it("для другого шага заводит другую сессию", () => {
    const db = freshDb();
    expect(openChatSession(db, SLUG, "004-t")).not.toBe(openChatSession(db, SLUG, "003-t"));
  });
});

describe("addChatMessage / readChatSession", () => {
  it("хранит реплики в порядке добавления", () => {
    const db = freshDb();
    const session = openChatSession(db, SLUG, "003-t");
    addChatMessage(db, session, "user", "Почему внутренние размерности?");
    addChatMessage(db, session, "assistant", "Потому что строка идёт по столбцу.");

    const stored = readChatSession(db, session);
    expect(stored?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(stored?.messages[1].text).toContain("столбцу");
    expect(stored?.messages[1].kept).toBe(false);
  });

  it("на неизвестном id отдаёт null", () => {
    expect(readChatSession(freshDb(), 4242)).toBeNull();
  });

  it("findChatSession находит сессию по уроку и шагу", () => {
    const db = freshDb();
    const session = openChatSession(db, SLUG, "003-t");
    addChatMessage(db, session, "user", "Вопрос");
    expect(findChatSession(db, SLUG, "003-t")?.id).toBe(session);
    expect(findChatSession(db, SLUG, "нет-такого")).toBeNull();
  });

  // Осторожно: это НЕ доказательство того, что сортировка идёт по id, а не
  // по created_at. SQLite сортирует стабильно, и без LIMIT (как здесь, через
  // readChatSession) ORDER BY id, ORDER BY created_at при равных таймстампах
  // и вообще без ORDER BY возвращают строки в одном и том же порядке —
  // порядке скана по rowid. Тест ниже честно фиксирует наблюдаемое поведение
  // readChatSession (реплики приходят в порядке вставки), но не различает,
  // на каком столбце держится эта сортировка. Различающий тест — у
  // recentHistory ниже: там ORDER BY … DESC LIMIT ? реально выбирает разные
  // строки в зависимости от ключа сортировки при равных таймстампах.
  it("readChatSession отдаёт реплики в порядке вставки даже при одинаковом таймстампе (не различает id/created_at — см. тест на recentHistory)", () => {
    const db = freshDb();
    const session = openChatSession(db, SLUG, "003-t");
    const sameInstant = "2026-08-10T12:00:00.000Z";
    const total = 200;

    for (let i = 0; i < total; i += 1) {
      addChatMessage(db, session, i % 2 === 0 ? "user" : "assistant", `msg-${i}`, sameInstant);
    }

    const stored = readChatSession(db, session);
    expect(stored?.messages).toHaveLength(total);
    expect(stored?.messages.map((message) => message.text)).toEqual(
      Array.from({ length: total }, (_, i) => `msg-${i}`),
    );
  });

  // Сессия принадлежит паре (урок, шаг): чужой шаг того же урока и тот же
  // шаг в другом уроке не должны видеть чужие реплики.
  it("не путает реплики разных шагов одного урока", () => {
    const db = freshDb();
    const stepA = openChatSession(db, SLUG, "003-t");
    const stepB = openChatSession(db, SLUG, "004-t");

    addChatMessage(db, stepA, "user", "Вопрос про шаг A");
    addChatMessage(db, stepB, "user", "Вопрос про шаг B");

    const a = readChatSession(db, stepA);
    const b = readChatSession(db, stepB);
    expect(a?.messages.map((m) => m.text)).toEqual(["Вопрос про шаг A"]);
    expect(b?.messages.map((m) => m.text)).toEqual(["Вопрос про шаг B"]);
  });

  it("не путает одинаковый step_id в разных уроках", () => {
    const db = freshDb();
    const otherSlug = "02-another-lesson__01-alpha";
    const first = openChatSession(db, SLUG, "003-t");
    const second = openChatSession(db, otherSlug, "003-t");
    expect(second).not.toBe(first);

    addChatMessage(db, first, "user", "Вопрос в первом уроке");
    addChatMessage(db, second, "user", "Вопрос во втором уроке");

    expect(readChatSession(db, first)?.messages.map((m) => m.text)).toEqual([
      "Вопрос в первом уроке",
    ]);
    expect(readChatSession(db, second)?.messages.map((m) => m.text)).toEqual([
      "Вопрос во втором уроке",
    ]);
    expect(findChatSession(db, SLUG, "003-t")?.id).toBe(first);
    expect(findChatSession(db, otherSlug, "003-t")?.id).toBe(second);
  });
});

describe("recentHistory", () => {
  it("отдаёт последние реплики в хронологическом порядке", () => {
    const db = freshDb();
    const session = openChatSession(db, SLUG, "003-t");
    for (let i = 0; i < 10; i += 1) {
      addChatMessage(db, session, i % 2 === 0 ? "user" : "assistant", `реплика ${i}`);
    }

    const history = recentHistory(db, session, 4);
    expect(history).toHaveLength(4);
    expect(history[0].text).toBe("реплика 6");
    expect(history[3].text).toBe("реплика 9");
  });

  it("не возвращает реплики другого шага", () => {
    const db = freshDb();
    const stepA = openChatSession(db, SLUG, "003-t");
    const stepB = openChatSession(db, SLUG, "004-t");
    addChatMessage(db, stepA, "user", "A1");
    addChatMessage(db, stepB, "user", "B1");
    addChatMessage(db, stepB, "assistant", "B2");

    expect(recentHistory(db, stepA, 10).map((m) => m.text)).toEqual(["A1"]);
    expect(recentHistory(db, stepB, 10).map((m) => m.text)).toEqual(["B1", "B2"]);
  });

  it("без явного лимита ограничивает историю разумным значением по умолчанию", () => {
    const db = freshDb();
    const session = openChatSession(db, SLUG, "003-t");
    for (let i = 0; i < 20; i += 1) {
      addChatMessage(db, session, i % 2 === 0 ? "user" : "assistant", `реплика ${i}`);
    }

    const history = recentHistory(db, session);
    expect(history.length).toBeLessThan(20);
    expect(history[history.length - 1].text).toBe("реплика 19");
  });

  // Это тот случай, где выбор ключа сортировки реально меняет результат:
  // ORDER BY … DESC LIMIT ? выбирает, КАКИЕ строки попадут в ответ, а не
  // только их порядок. При равных таймстампах сортировка по created_at
  // (стабильная, поэтому равные значения остаются в порядке скана по
  // rowid — то есть по возрастанию id) отдала бы LIMIT первых по id строк,
  // то есть САМЫЕ СТАРЫЕ реплики — а не последние, как должно быть у
  // истории для промпта. Больше сообщений, чем limit, все с одним now —
  // так это отличимо от бага «сортируем по created_at вместо id».
  it("при одинаковом таймстампе limit отбирает именно последние N вставленных, а не первые", () => {
    const db = freshDb();
    const session = openChatSession(db, SLUG, "003-t");
    const sameInstant = "2026-08-10T12:00:00.000Z";
    const total = 50;
    const limit = 5;

    for (let i = 0; i < total; i += 1) {
      addChatMessage(db, session, i % 2 === 0 ? "user" : "assistant", `msg-${i}`, sameInstant);
    }

    const history = recentHistory(db, session, limit);
    expect(history.map((message) => message.text)).toEqual(
      Array.from({ length: limit }, (_, i) => `msg-${total - limit + i}`),
    );
  });
});

describe("markMessageKept", () => {
  it("помечает конкретную реплику как оставленную в теории", () => {
    const db = freshDb();
    const session = openChatSession(db, SLUG, "003-t");
    const kept = addChatMessage(db, session, "assistant", "Ответ, который останется.");
    markMessageKept(db, kept);

    expect(readChatSession(db, session)?.messages[0].kept).toBe(true);
  });
});

describe("formatHistory", () => {
  it("складывает реплики в диалог", () => {
    const db = freshDb();
    const session = openChatSession(db, SLUG, "003-t");
    addChatMessage(db, session, "user", "Короткий вопрос");
    addChatMessage(db, session, "assistant", "Короткий ответ");

    expect(formatHistory(recentHistory(db, session, 6))).toBe(
      "Ученик: Короткий вопрос\nТы: Короткий ответ",
    );
  });

  it("режет историю с начала, оставляя свежие реплики", () => {
    const db = freshDb();
    const session = openChatSession(db, SLUG, "003-t");
    for (let i = 0; i < 6; i += 1) {
      addChatMessage(db, session, i % 2 === 0 ? "user" : "assistant", `реплика ${i} ${"я".repeat(500)}`);
    }

    const text = formatHistory(recentHistory(db, session, 6));
    expect(text.length).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
    expect(text).toContain("реплика 5");
    expect(text).not.toContain("реплика 0");
  });

  it("одну гигантскую реплику обрезает, а не выбрасывает целиком", () => {
    const db = freshDb();
    const session = openChatSession(db, SLUG, "003-t");
    addChatMessage(db, session, "assistant", "я".repeat(5000));

    const text = formatHistory(recentHistory(db, session, 6));
    expect(text.startsWith("Ты: ")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
  });

  it("на пустой истории говорит, что это первый вопрос", () => {
    expect(formatHistory([])).toBe("(это первый вопрос в этом чате)");
  });
});
