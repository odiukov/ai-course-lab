import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findLesson } from "../source/catalog";
import { readLessonSource } from "../source/lesson-source";
import type { StepMeta } from "./step-file";
import { isStale, readLessonPlan, validatePlan, writeLessonPlan, type LessonPlan } from "./lesson-plan";

const COURSE = path.resolve(__dirname, "../../../tests/fixtures/course");
const SOURCE = readLessonSource(COURSE, findLesson(COURSE, "01-math-foundations__02-beta")!);

function step(over: Partial<StepMeta> & Pick<StepMeta, "id" | "type">): StepMeta {
  return { title: over.id, ...over } as StepMeta;
}

const GOOD: StepMeta[] = [
  step({ id: "001-t", type: "theory" }),
  step({ id: "002-c", type: "code", exercise_fn: "transpose" }),
  step({ id: "003-t", type: "theory" }),
  step({ id: "004-c", type: "code", exercise_fn: "matmul" }),
];

describe("validatePlan", () => {
  it("принимает чередующийся план", () => {
    expect(validatePlan(GOOD, SOURCE)).toEqual([]);
  });

  it("ругается на два code-шага подряд без теории между ними", () => {
    const bad = [
      step({ id: "001-t", type: "theory" }),
      step({ id: "002-c", type: "code", exercise_fn: "transpose" }),
      step({ id: "003-c", type: "code", exercise_fn: "matmul" }),
    ];
    expect(validatePlan(bad, SOURCE).join(" ")).toMatch(/подряд/);
  });

  it("ругается на неизвестную функцию", () => {
    const bad = [...GOOD, step({ id: "005-c", type: "code", exercise_fn: "nope" })];
    expect(validatePlan(bad, SOURCE).join(" ")).toMatch(/nope/);
  });

  it("ругается на code-шаг без exercise_fn", () => {
    const bad = [step({ id: "001-t", type: "theory" }), step({ id: "002-c", type: "code" })];
    expect(validatePlan(bad, SOURCE).join(" ")).toMatch(/exercise_fn/);
  });

  it("ругается на дубликаты id", () => {
    const bad = [step({ id: "001-t", type: "theory" }), step({ id: "001-t", type: "theory" })];
    expect(validatePlan(bad, SOURCE).join(" ")).toMatch(/001-t/);
  });

  it("требует покрыть все функции упражнения", () => {
    const bad = GOOD.slice(0, 2);
    expect(validatePlan(bad, SOURCE).join(" ")).toMatch(/matmul/);
  });

  it("ругается на visual вне списка визуализаций урока", () => {
    const bad = [...GOOD, step({ id: "006-v", type: "visual", visual: "learning-visuals/nope.html" })];
    expect(validatePlan(bad, SOURCE).join(" ")).toMatch(/nope\.html/);
  });

  it("ругается, если все code-шаги свалены в конец после теории", () => {
    const bad = [
      step({ id: "001-t", type: "theory" }),
      step({ id: "002-t", type: "theory" }),
      step({ id: "003-t", type: "theory" }),
      step({ id: "004-c", type: "code", exercise_fn: "transpose" }),
      step({ id: "005-c", type: "code", exercise_fn: "matmul" }),
    ];
    expect(validatePlan(bad, SOURCE).join(" ")).toMatch(/подряд/);
  });
});

describe("чтение и запись", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lab-"));
  const plan: LessonPlan = {
    slug: "01-math-foundations__02-beta",
    title: "Beta",
    lang: "ru",
    sourcePath: SOURCE.textPath,
    sourceHash: SOURCE.sourceHash,
    generatedAt: "2026-08-09T00:00:00.000Z",
    steps: GOOD,
  };

  it("возвращает null, если плана нет", () => {
    expect(readLessonPlan(tmp, "01-math-foundations__02-beta")).toBeNull();
  });

  it("пишет и читает обратно", () => {
    writeLessonPlan(tmp, plan);
    expect(readLessonPlan(tmp, plan.slug)).toEqual(plan);
  });

  it("считает план протухшим при смене хеша", () => {
    expect(isStale(plan, SOURCE)).toBe(false);
    expect(isStale({ ...plan, sourceHash: "beef" }, SOURCE)).toBe(true);
  });
});
