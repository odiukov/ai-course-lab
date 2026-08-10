import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendClarification,
  parseClarifications,
  readClarifications,
  readLessonClarifications,
  serializeClarification,
  type Clarification,
} from "./clarifications";

const SLUG = "01-math-foundations__02-beta";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clar-"));
}

const ONE: Clarification = {
  askedAt: "2026-08-10T09:12:33.000Z",
  question: "Почему внутренние размерности должны совпадать?",
  answer: "Потому что каждая строка A умножается на столбец B поэлементно.",
};

describe("serializeClarification / parseClarifications", () => {
  it("делает полный круг без потерь", () => {
    expect(parseClarifications(serializeClarification(ONE))).toEqual([ONE]);
  });

  it("разбирает несколько блоков подряд", () => {
    const two: Clarification = {
      askedAt: "2026-08-10T10:00:00.000Z",
      question: "А если матрица квадратная?",
      answer: "Тогда условие выполняется само.",
    };
    const file = `${serializeClarification(ONE)}\n${serializeClarification(two)}`;
    expect(parseClarifications(file).map((item) => item.question)).toEqual([
      ONE.question,
      two.question,
    ]);
  });

  it("не разваливается на ответе с собственными заголовками", () => {
    const withHeadings: Clarification = {
      askedAt: "2026-08-10T11:00:00.000Z",
      question: "Как это выглядит на примере?",
      answer: "## Пример\n\nБерём матрицу 2x3.\n\n## Ещё пример\n\nИ 3x2.",
    };
    const parsed = parseClarifications(serializeClarification(withHeadings));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].answer).toContain("## Ещё пример");
  });

  it("обезвреживает маркер, попавший внутрь ответа, и восстанавливает ответ посимвольно", () => {
    const evil: Clarification = {
      askedAt: "2026-08-10T12:00:00.000Z",
      question: "Что будет, если написать маркер?",
      answer: "Вот так:\n<!-- clarification: 1999-01-01T00:00:00.000Z -->\nи всё.",
    };
    const parsed = parseClarifications(serializeClarification(evil));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].askedAt).toBe("2026-08-10T12:00:00.000Z");
    // Полный круг: обезвреженный маркер внутри ответа должен вернуться
    // ровно тем же текстом, а не с оставшимся служебным пробелом.
    expect(parsed[0]).toEqual(evil);
  });

  it("сохраняет многострочный вопрос без потерь", () => {
    const multiline: Clarification = {
      askedAt: "2026-08-10T15:00:00.000Z",
      question: "Первая строка вопроса\nвторая строка вопроса",
      answer: "Ответ на многострочный вопрос.",
    };
    const parsed = parseClarifications(serializeClarification(multiline));
    expect(parsed).toEqual([multiline]);
  });

  it("сохраняет повторяющиеся пробелы внутри вопроса без потерь", () => {
    const spaced: Clarification = {
      askedAt: "2026-08-10T16:00:00.000Z",
      question: "Вопрос  с   двумя и тремя пробелами подряд?",
      answer: "Ответ.",
    };
    const parsed = parseClarifications(serializeClarification(spaced));
    expect(parsed).toEqual([spaced]);
  });

  it("игнорирует текст до первого маркера", () => {
    const file = `Ручная заметка сверху.\n\n${serializeClarification(ONE)}`;
    expect(parseClarifications(file)).toEqual([ONE]);
  });
});

describe("readClarifications / appendClarification", () => {
  it("на отсутствующем файле отдаёт пустой список", () => {
    expect(readClarifications(tmpDir(), SLUG, "003-broadcasting")).toEqual([]);
  });

  it("создаёт файл и дописывает второй блок, не трогая первый", () => {
    const contentDir = tmpDir();
    appendClarification(contentDir, SLUG, "003-broadcasting", ONE);
    appendClarification(contentDir, SLUG, "003-broadcasting", {
      askedAt: "2026-08-10T13:00:00.000Z",
      question: "А в numpy это как?",
      answer: "Оператор `@`.",
    });

    const items = readClarifications(contentDir, SLUG, "003-broadcasting");
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(ONE);
    expect(items[1].question).toBe("А в numpy это как?");
  });
});

describe("readLessonClarifications", () => {
  it("раскладывает уточнения по id шагов", () => {
    const contentDir = tmpDir();
    appendClarification(contentDir, SLUG, "003-broadcasting", ONE);
    appendClarification(contentDir, SLUG, "011-transpose", {
      askedAt: "2026-08-10T14:00:00.000Z",
      question: "Транспонирование меняет данные?",
      answer: "Нет, только их раскладку.",
    });

    const byStep = readLessonClarifications(contentDir, SLUG);
    expect([...byStep.keys()].sort()).toEqual(["003-broadcasting", "011-transpose"]);
    expect(byStep.get("011-transpose")?.[0].question).toBe("Транспонирование меняет данные?");
  });

  it("на уроке без уточнений отдаёт пустую карту", () => {
    expect(readLessonClarifications(tmpDir(), SLUG).size).toBe(0);
  });
});
