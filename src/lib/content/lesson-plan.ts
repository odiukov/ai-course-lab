import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { LessonSource } from "../source/lesson-source";
import { lessonPaths } from "./paths";
import { stepMetaSchema, type StepMeta } from "./step-file";

const planSchema = z.object({
  slug: z.string(),
  title: z.string(),
  lang: z.enum(["ru", "en"]),
  sourcePath: z.string(),
  sourceHash: z.string(),
  generatedAt: z.string(),
  steps: z.array(stepMetaSchema),
});

export type LessonPlan = z.infer<typeof planSchema>;

export function validatePlan(steps: StepMeta[], source: LessonSource): string[] {
  const errors: string[] = [];

  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) errors.push(`Дубликат id шага: ${step.id}`);
    seen.add(step.id);
  }

  const known = new Set(source.exercise?.functions ?? []);
  const used = new Set<string>();
  let theorySincePrevCode = true;

  for (const step of steps) {
    if (step.type === "theory") {
      theorySincePrevCode = true;
      continue;
    }
    if (step.type !== "code") continue;

    if (!step.exercise_fn) {
      errors.push(`Шаг ${step.id}: у code-шага нет exercise_fn`);
    } else {
      if (!known.has(step.exercise_fn)) {
        errors.push(`Шаг ${step.id}: функция ${step.exercise_fn} отсутствует в упражнении`);
      }
      if (used.has(step.exercise_fn)) {
        errors.push(`Шаг ${step.id}: функция ${step.exercise_fn} уже занята другим шагом`);
      }
      used.add(step.exercise_fn);
    }
    if (!theorySincePrevCode) {
      errors.push(`Шаг ${step.id}: два code-шага подряд, между ними нет теории`);
    }
    theorySincePrevCode = false;
  }

  for (const fn of known) {
    if (!used.has(fn)) errors.push(`Функция ${fn} не покрыта ни одним code-шагом`);
  }

  const visuals = new Set(source.visuals);
  for (const step of steps) {
    if (step.visual && !visuals.has(step.visual)) {
      errors.push(`Шаг ${step.id}: визуализация ${step.visual} не найдена в уроке`);
    }
  }

  return errors;
}

export function readLessonPlan(contentDir: string, slug: string): LessonPlan | null {
  const file = lessonPaths(contentDir, slug).planFile;
  if (!fs.existsSync(file)) return null;
  return planSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function writeLessonPlan(contentDir: string, plan: LessonPlan): void {
  const paths = lessonPaths(contentDir, plan.slug);
  fs.mkdirSync(path.dirname(paths.planFile), { recursive: true });
  fs.writeFileSync(paths.planFile, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

export function isStale(plan: LessonPlan, source: LessonSource): boolean {
  return plan.sourceHash !== source.sourceHash;
}
