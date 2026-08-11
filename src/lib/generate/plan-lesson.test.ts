import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findLesson } from "../source/catalog";
import { readLessonSource } from "../source/lesson-source";
import { readLessonPlan } from "../content/lesson-plan";
import { MAX_STEPS, countWords, extractJsonBlock, generateLessonPlan, stepBudget } from "./plan-lesson";

const COURSE = path.resolve(__dirname, "../../../tests/fixtures/course");
const SOURCE = readLessonSource(COURSE, findLesson(COURSE, "01-math-foundations__02-beta")!);

const VALID = JSON.stringify([
  { id: "001-t", type: "theory", title: "Зачем" },
  { id: "002-c", type: "code", title: "transpose", exercise_fn: "transpose" },
  { id: "003-t", type: "theory", title: "Умножение" },
  { id: "004-c", type: "code", title: "matmul", exercise_fn: "matmul" },
]);

const BROKEN = JSON.stringify([
  { id: "001-c", type: "code", title: "transpose", exercise_fn: "transpose" },
  { id: "002-c", type: "code", title: "matmul", exercise_fn: "matmul" },
]);

const SCHEMA_INVALID = JSON.stringify([
  { id: "001-t", type: "theory", title: "Зачем" },
  { id: "002-c", type: "unknown", title: "transpose", exercise_fn: "transpose" },
]);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "plan-"));
}

describe("extractJsonBlock", () => {
  it("достаёт JSON из блока с ```json", () => {
    expect(extractJsonBlock("бла\n```json\n[1,2]\n```\nбла")).toEqual([1, 2]);
  });

  it("достаёт голый JSON без блока", () => {
    expect(extractJsonBlock("[1,2]")).toEqual([1, 2]);
  });

  it("падает, если JSON нет", () => {
    expect(() => extractJsonBlock("просто текст")).toThrow(/JSON/);
  });

  it("достаёт голый JSON с текстом после него", () => {
    expect(extractJsonBlock("Here is the plan: [1,2] Hope this helps!")).toEqual([1, 2]);
  });

  it("пропускает нерелевантный ```python-блок и находит JSON после него", () => {
    expect(extractJsonBlock("```python\nx = 1\n```\n[1,2]")).toEqual([1, 2]);
  });

  it("не обрезает массив на ] внутри строкового значения", () => {
    const json = JSON.stringify([{ id: "001-t", type: "theory", title: "Шаг [важный]" }]);
    expect(extractJsonBlock(json)).toEqual([{ id: "001-t", type: "theory", title: "Шаг [важный]" }]);
  });

  it("пропускает первый нерелевантный блок и берёт JSON из второго", () => {
    const text = "```text\nэто не JSON\n```\n```json\n[1,2]\n```";
    expect(extractJsonBlock(text)).toEqual([1, 2]);
  });
});

describe("generateLessonPlan", () => {
  it("сохраняет валидный план на диск", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("```json\n" + VALID + "\n```");
    const plan = await generateLessonPlan({ contentDir, source: SOURCE, deps: { run } });
    expect(plan.steps).toHaveLength(4);
    expect(plan.sourceHash).toBe(SOURCE.sourceHash);
    expect(readLessonPlan(contentDir, SOURCE.ref.slug)?.steps).toHaveLength(4);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("пишет sourcePath относительно корня репозитория, а не абсолютным", async () => {
    // lesson.json лежит в git: абсолютный путь утёк бы вместе с раскладкой
    // машины автора и был бы бесполезен в любом другом клоне.
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("```json\n" + VALID + "\n```");
    const plan = await generateLessonPlan({ contentDir, source: SOURCE, deps: { run } });
    expect(path.isAbsolute(plan.sourcePath)).toBe(false);
    expect(plan.sourcePath).toBe(
      "tests/fixtures/course/i18n/ru/phases/01-math-foundations/02-beta/docs/ru.md",
    );
  });

  it("перезапрашивает один раз, если план нарушает правила", async () => {
    const contentDir = tmpDir();
    const run = vi
      .fn()
      .mockResolvedValueOnce(BROKEN)
      .mockResolvedValueOnce(VALID);
    const plan = await generateLessonPlan({ contentDir, source: SOURCE, deps: { run } });
    expect(plan.steps).toHaveLength(4);
    expect(run).toHaveBeenCalledTimes(2);
    expect(String(run.mock.calls[1][0])).toMatch(/подряд/);
  });

  it("сдаётся после второй неудачи", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue(BROKEN);
    await expect(generateLessonPlan({ contentDir, source: SOURCE, deps: { run } }))
      .rejects.toThrow(/план/i);
    expect(readLessonPlan(contentDir, SOURCE.ref.slug)).toBeNull();
  });

  it("перезапрашивает, если первый ответ вообще не содержит JSON", async () => {
    const contentDir = tmpDir();
    const run = vi
      .fn()
      .mockResolvedValueOnce("Sorry, I cannot help with that request today.")
      .mockResolvedValueOnce(VALID);
    const plan = await generateLessonPlan({ contentDir, source: SOURCE, deps: { run } });
    expect(plan.steps).toHaveLength(4);
    expect(run).toHaveBeenCalledTimes(2);
    expect(String(run.mock.calls[1][0])).toMatch(/JSON/);
  });

  it("перезапрашивает, если JSON не проходит схему шага", async () => {
    const contentDir = tmpDir();
    const run = vi
      .fn()
      .mockResolvedValueOnce(SCHEMA_INVALID)
      .mockResolvedValueOnce(VALID);
    const plan = await generateLessonPlan({ contentDir, source: SOURCE, deps: { run } });
    expect(plan.steps).toHaveLength(4);
    expect(run).toHaveBeenCalledTimes(2);
    expect(String(run.mock.calls[1][0])).toMatch(/type/);
  });

  it("прокидывает события из run в onEvent", async () => {
    const contentDir = tmpDir();
    const events: unknown[] = [];
    const run = vi.fn().mockImplementation(async (_prompt: string, onEvent: (e: unknown) => void) => {
      onEvent({ type: "text", text: "генерирую..." });
      return VALID;
    });
    await generateLessonPlan({ contentDir, source: SOURCE, deps: { run }, onEvent: (e) => events.push(e) });
    expect(events).toEqual([{ type: "text", text: "генерирую..." }]);
  });
});

describe("stepBudget", () => {
  it("короткий урок не растягивается до потолка", () => {
    expect(stepBudget(600, 0)).toBe(15);
    expect(stepBudget(1200, 0)).toBeLessThan(MAX_STEPS);
  });

  // Смысл ориентира — плотность разбора, а не попадание в число: вдвое
  // длиннее исходник — вдвое больше экранов.
  it("шаги растут пропорционально объёму исходника", () => {
    expect(stepBudget(4000, 0) - stepBudget(2000, 0)).toBe(2000 / 80);
  });

  // Длинные уроки в курсе есть: 90-й процентиль — 2938 слов, максимум 5933.
  // Прежний потолок в 40 обрезал их ровно там, где мыслей больше всего.
  it("длинный урок разбирается подробно, а не обрезается", () => {
    expect(stepBudget(2938, 8)).toBeGreaterThan(40);
    expect(stepBudget(5933, 8)).toBe(MAX_STEPS);
  });

  // Объём взят выше нижней границы: на коротком уроке разницу съедает клэмп,
  // и проверка мерила бы его, а не вклад функций.
  it("каждая функция упражнения добавляет шаг: их пропустить нельзя", () => {
    expect(stepBudget(2000, 5) - stepBudget(2000, 0)).toBe(5);
  });

  it("не выходит за границы", () => {
    expect(stepBudget(0, 0)).toBe(15);
    expect(stepBudget(100000, 40)).toBe(MAX_STEPS);
  });
});

describe("countWords", () => {
  it("считает слова, а не пробелы", () => {
    expect(countWords("раз два  три\nчетыре")).toBe(4);
    expect(countWords("   ")).toBe(0);
  });
});
