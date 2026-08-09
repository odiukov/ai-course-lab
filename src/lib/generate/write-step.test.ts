import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findLesson } from "../source/catalog";
import { readLessonSource } from "../source/lesson-source";
import { readStep } from "../content/step-file";
import type { LessonPlan } from "../content/lesson-plan";
import { ensureSteps, excerptForStep } from "./write-step";

const COURSE = path.resolve(__dirname, "../../../tests/fixtures/course");
const SOURCE = readLessonSource(COURSE, findLesson(COURSE, "01-math-foundations__02-beta")!);

const PLAN: LessonPlan = {
  slug: SOURCE.ref.slug,
  title: "Beta",
  lang: SOURCE.lang,
  sourcePath: SOURCE.textPath,
  sourceHash: SOURCE.sourceHash,
  generatedAt: "2026-08-09T00:00:00.000Z",
  steps: [
    { id: "001-t", type: "theory", title: "Зачем", source_anchor: "### Транспонирование" },
    { id: "002-c", type: "code", title: "transpose", exercise_fn: "transpose" },
    { id: "003-t", type: "theory", title: "Дальше" },
    { id: "004-c", type: "code", title: "matmul", exercise_fn: "matmul" },
  ],
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "steps-"));
}

describe("excerptForStep", () => {
  it("режет исходник по якорю до следующего заголовка того же уровня", () => {
    const text = excerptForStep(SOURCE, "### Транспонирование");
    expect(text).toContain("Переворачиваем строки");
    expect(text).not.toContain("# Урок");
  });

  it("без якоря отдаёт начало урока", () => {
    expect(excerptForStep(SOURCE).length).toBeGreaterThan(0);
  });
});

describe("ensureSteps", () => {
  it("генерит окно из трёх шагов", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("Тело шага.");
    const ids = await ensureSteps({ contentDir, source: SOURCE, plan: PLAN, fromIndex: 0, deps: { run } });
    expect(ids).toEqual(["001-t", "002-c", "003-t"]);
    expect(readStep(contentDir, PLAN.slug, "002-c")?.body).toBe("Тело шага.");
    expect(readStep(contentDir, PLAN.slug, "002-c")?.exercise_fn).toBe("transpose");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("не перегенерирует уже существующие шаги", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("Тело шага.");
    await ensureSteps({ contentDir, source: SOURCE, plan: PLAN, fromIndex: 0, count: 1, deps: { run } });
    await ensureSteps({ contentDir, source: SOURCE, plan: PLAN, fromIndex: 0, count: 2, deps: { run } });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("не вылезает за конец плана", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("Тело.");
    const ids = await ensureSteps({ contentDir, source: SOURCE, plan: PLAN, fromIndex: 3, deps: { run } });
    expect(ids).toEqual(["004-c"]);
  });
});
