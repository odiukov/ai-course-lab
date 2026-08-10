import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { LessonSource } from "../source/lesson-source";
import type { WrittenFunction } from "../source/written-functions";
import { lessonPaths, SAFE_SEGMENT } from "./paths";
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

export function validatePlan(
  steps: StepMeta[],
  source: LessonSource,
  written: WrittenFunction[] = [],
): string[] {
  const errors: string[] = [];

  const seen = new Set<string>();
  for (const step of steps) {
    // Из id собираются имена файлов — шага, уточнения, схемы. Кириллица или
    // точка в нём проходят до самого ридера и умирают там: файл записан,
    // а /api/visual отклоняет сегмент и отдаёт пустой iframe. Форму гасим
    // здесь, пока планировщику ещё можно вернуть ошибку на переделку.
    if (!SAFE_SEGMENT.test(step.id)) {
      errors.push(
        `Шаг ${step.id}: id может состоять только из латиницы, цифр, дефиса и подчёркивания — из него собирается имя файла`,
      );
    }
    if (seen.has(step.id)) errors.push(`Дубликат id шага: ${step.id}`);
    seen.add(step.id);
  }

  const known = new Set(source.exercise?.functions ?? []);
  const used = new Set<string>();
  const writtenByName = new Map(written.map((item) => [item.fn, item]));
  let theorySincePrevCode = true;

  for (const step of steps) {
    if (step.type === "theory") {
      theorySincePrevCode = true;
      continue;
    }
    if (step.type !== "code" && step.type !== "recall") continue;

    if (!step.exercise_fn) {
      errors.push(`Шаг ${step.id}: у ${step.type}-шага нет exercise_fn`);
    } else {
      if (!known.has(step.exercise_fn)) {
        errors.push(`Шаг ${step.id}: функция ${step.exercise_fn} отсутствует в упражнении`);
      }
      if (used.has(step.exercise_fn)) {
        errors.push(`Шаг ${step.id}: функция ${step.exercise_fn} уже занята другим шагом`);
      }
      used.add(step.exercise_fn);
    }

    if (step.type !== "code") continue;

    const previous = step.exercise_fn ? writtenByName.get(step.exercise_fn) : undefined;
    if (previous && !step.baseline?.changes) {
      errors.push(
        `Шаг ${step.id}: функция ${step.exercise_fn} уже написана (${previous.lessonSlug ?? previous.exerciseSlug}). ` +
          `Нужен либо шаг recall, либо baseline с описанием того, что меняется`,
      );
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

    if (step.type !== "visual") {
      if (step.visual_brief) {
        errors.push(
          `Шаг ${step.id}: visual_brief у шага типа ${step.type} — такую схему никто не покажет`,
        );
      }
      continue;
    }

    if (step.visual && step.visual_brief) {
      errors.push(`Шаг ${step.id}: заданы и visual, и visual_brief — нужно ровно одно`);
    }
    if (!step.visual && !step.visual_brief) {
      errors.push(`Шаг ${step.id}: у visual-шага нет ни visual, ни visual_brief`);
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
