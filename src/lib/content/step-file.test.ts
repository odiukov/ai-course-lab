import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkSchema,
  parseStep,
  readStepsById,
  serializeStep,
  writeStep,
  type Step,
} from "./step-file";

const SAMPLE = `---
id: "003-broadcasting"
type: theory
title: Броадкастинг
source_anchor: "## Broadcasting"
---

Тело шага.
`;

describe("parseStep", () => {
  it("читает frontmatter и тело", () => {
    const step = parseStep(SAMPLE);
    expect(step.id).toBe("003-broadcasting");
    expect(step.type).toBe("theory");
    expect(step.title).toBe("Броадкастинг");
    expect(step.body.trim()).toBe("Тело шага.");
  });

  it("падает на неизвестном типе", () => {
    expect(() => parseStep(SAMPLE.replace("type: theory", "type: video")))
      .toThrow(/type/);
  });

  it("падает без id", () => {
    expect(() => parseStep(SAMPLE.replace('id: "003-broadcasting"\n', "")))
      .toThrow(/id/);
  });

  it("читает вопросы шага check", () => {
    const md = `---
id: "004-check"
type: check
title: Проверка
check:
  - question: Что должно совпасть?
    options: ["внешние", "внутренние"]
    correct: 1
    explanation: Столбцы A равны строкам B.
---
`;
    const step = parseStep(md);
    expect(step.check?.[0].correct).toBe(1);
  });

  it("отклоняет пустой visual_brief", () => {
    const markdown = [
      "---",
      "id: 001-v",
      "type: visual",
      "title: Схема",
      'visual_brief: ""',
      "---",
      "",
      "Текст.",
    ].join("\n");

    expect(() => parseStep(markdown)).toThrow();
  });
});

// Вопросы теперь пишет генерация, а не человек, поэтому форму нельзя оставлять
// на доверии: шаг с correct вне списка вариантов записывался на диск, а пройти
// его после этого было нельзя никогда — сервер сверял ответ с вариантом,
// которого нет.
describe("checkSchema: границы вопроса", () => {
  const question = { question: "Что совпадает?", options: ["внешние", "внутренние"], correct: 1 };

  it("вопрос в границах проходит", () => {
    expect(checkSchema.safeParse(question).success).toBe(true);
  });

  it("correct за пределами списка вариантов — отказ", () => {
    const bad = checkSchema.safeParse({ ...question, correct: 2 });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].message).toMatch(/вне списка/);
    expect(bad.error?.issues[0].path).toEqual(["correct"]);
  });

  it("отрицательный и дробный correct — тоже отказ", () => {
    expect(checkSchema.safeParse({ ...question, correct: -1 }).success).toBe(false);
    expect(checkSchema.safeParse({ ...question, correct: 0.5 }).success).toBe(false);
  });

  it("меньше двух вариантов — отказ: выбирать не из чего", () => {
    const bad = checkSchema.safeParse({ ...question, options: ["один"], correct: 0 });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].message).toMatch(/минимум два/);
  });

  it("шаг с таким вопросом не разбирается целиком", () => {
    const md = `---
id: "004-check"
type: check
title: Проверка
check:
  - question: Что должно совпасть?
    options: ["внешние", "внутренние"]
    correct: 7
---
`;
    expect(() => parseStep(md)).toThrow(/correct|вне списка/);
  });
});

// Проверочные шаги урока 02 — те, ради которых схема и ужесточается. Новые
// границы не должны отвергать уже написанное.
//
// Числом шагов проверка не связана намеренно: урок пересобирается, и в новом
// плане их столько, сколько требует материал. Прибитое число ловило бы не
// поломку схемы, а очередной разбор.
describe("шаги урока 02 с вопросами", () => {
  const dir = path.join(
    process.cwd(),
    "content/lessons/01-math-foundations__02-vectors-matrices-operations/steps",
  );

  it("все check-шаги на диске проходят схему", () => {
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".md"));
    const withCheck = files
      .map((name) => parseStep(fs.readFileSync(path.join(dir, name), "utf8")))
      .filter((step) => (step.check?.length ?? 0) > 0);

    expect(withCheck.length).toBeGreaterThan(0);
    for (const step of withCheck) {
      for (const item of step.check!) {
        expect(item.options.length).toBeGreaterThanOrEqual(2);
        expect(item.correct).toBeLessThan(item.options.length);
      }
    }
  });
});

describe("serializeStep", () => {
  it("делает полный круг без потерь", () => {
    const step: Step = {
      id: "005-matmul",
      type: "code",
      title: "Пишем matmul",
      exercise_fn: "matmul",
      body: "Реализуй функцию.",
    };
    const round = parseStep(serializeStep(step));
    expect(round).toEqual(step);
  });

  it("не пишет пустые поля", () => {
    const out = serializeStep({ id: "001-a", type: "theory", title: "А", body: "Б" });
    expect(out).not.toContain("visual");
    expect(out).not.toContain("exercise_fn");
    // Must contain required fields with correct values
    expect(out).toContain("id: 001-a");
    expect(out).toContain("type: theory");
    expect(out).toContain("title: А");
  });
});

describe("readStepsById", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function contentDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "steps-"));
    dirs.push(dir);
    return dir;
  }

  it("отдаёт написанные шаги под их id, а дыры просто отсутствуют", () => {
    const dir = contentDir();
    const ids = ["001-a", "002-b", "003-c", "004-d"];
    for (const id of ["002-b", "004-d"]) {
      writeStep(dir, "slug", { id, type: "theory", title: `Шаг ${id}`, body: `тело ${id}` });
    }

    const steps = readStepsById(dir, "slug", ids);

    expect(Object.keys(steps).sort()).toEqual(["002-b", "004-d"]);
    // Ключ — id из плана, а не позиция: дыра на 001 не сдвигает 002 на нулевое место.
    expect(steps["002-b"].body).toBe("тело 002-b");
    expect(steps["001-a"]).toBeUndefined();
    expect(steps["003-c"]).toBeUndefined();
  });

  it("на пустой директории отдаёт пустой объект, а не падает", () => {
    expect(readStepsById(contentDir(), "slug", ["001-a"])).toEqual({});
  });
});
