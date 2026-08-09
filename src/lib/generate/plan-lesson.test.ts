import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findLesson } from "../source/catalog";
import { readLessonSource } from "../source/lesson-source";
import { readLessonPlan } from "../content/lesson-plan";
import { extractJsonBlock, generateLessonPlan } from "./plan-lesson";

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
});
