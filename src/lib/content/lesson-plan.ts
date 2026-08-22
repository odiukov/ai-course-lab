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

/**
 * На сколько плану разрешено разойтись с ориентиром.
 *
 * Промпт просит «примерно N шагов», и без проверки это читается как
 * пожелание: при ориентире 40 приезжал план на 54. Четверть — это запас на
 * честное суждение («мыслей в тексте правда больше»), после которого речь уже
 * не о суждении, а о том, что ориентир не читали.
 */
const BUDGET_TOLERANCE = 0.25;

export function validatePlan(
  steps: StepMeta[],
  source: LessonSource,
  written: WrittenFunction[] = [],
  budget?: number,
): string[] {
  const errors: string[] = [];

  if (budget && budget > 0) {
    // Не меньше двух шагов запаса: на коротком уроке четверть — это один шаг,
    // и проверка придиралась бы к разнице, которая ничего не значит.
    const slack = Math.max(2, Math.round(budget * BUDGET_TOLERANCE));
    if (Math.abs(steps.length - budget) > slack) {
      const side = steps.length > budget ? "больше" : "меньше";
      errors.push(
        `В плане ${steps.length} шагов, а ориентир — ${budget} (допустимо ${budget - slack}-${budget + slack}). ` +
          `Это заметно ${side}: пересмотри разбивку, а не подгоняй счёт.`,
      );
    }
  }

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

  const known = source.exercise?.functions ?? [];
  // Множество файлов упражнения — по нему отличаем «файла нет вовсе» от
  // «файл есть, просто в нём нет такой функции».
  const knownFiles = new Set(known.map((pair) => pair.file));
  // Имя функции может встречаться в нескольких файлах упражнения (одно и то
  // же имя — две разные задачи). byName собирает для каждого имени список
  // файлов, где оно объявлено, чтобы отличить однозначный случай (файл один,
  // exercise_file можно не указывать) от случая, где угадать нельзя.
  const byName = new Map<string, string[]>();
  for (const pair of known) {
    byName.set(pair.fn, [...(byName.get(pair.fn) ?? []), pair.file]);
  }
  // Пара «файл + функция» — вот что на самом деле является задачей.
  // exercise_fn остаётся строкой (382 плана без exercise_file не должны
  // ломаться), а различать одноимённые функции в разных файлах приходится
  // склеенным ключом.
  const key = (file: string, fn: string) => `${file}::${fn}`;
  const used = new Set<string>();
  const writtenByName = new Map(written.map((item) => [key(item.file, item.fn), item]));
  let theorySincePrevCode = true;

  for (const step of steps) {
    if (step.type === "theory") {
      theorySincePrevCode = true;
      continue;
    }
    if (step.type !== "code" && step.type !== "recall") continue;

    let file: string | undefined;

    if (!step.exercise_fn) {
      errors.push(`Шаг ${step.id}: у ${step.type}-шага нет exercise_fn`);
    } else {
      const files = byName.get(step.exercise_fn) ?? [];
      if (files.length === 0) {
        errors.push(`Шаг ${step.id}: функция ${step.exercise_fn} отсутствует в упражнении`);
      } else if (step.exercise_file && !knownFiles.has(step.exercise_file)) {
        errors.push(`Шаг ${step.id}: в упражнении нет файла ${step.exercise_file}`);
      } else if (!step.exercise_file && files.length > 1) {
        // Одно имя в двух файлах — это две разные задачи, и шаг обязан сказать,
        // о какой он. Угадать нельзя: и тесты, и сброс, и recall пишут в файл.
        errors.push(
          `Шаг ${step.id}: функция ${step.exercise_fn} есть в нескольких файлах упражнения ` +
            `(${[...files].sort().join(", ")}) — укажи exercise_file`,
        );
      } else {
        file = step.exercise_file ?? files[0];
        if (used.has(key(file, step.exercise_fn))) {
          errors.push(
            `Шаг ${step.id}: функция ${step.exercise_fn} в ${file} уже занята другим шагом`,
          );
        }
        // recall обещает карточку «вот как ты написал это в прошлый раз», и
        // прошлый раз ищется по ДРУГИМ упражнениям курса (findPreviousImplementation
        // исключает текущее). Функция, которую человек ещё не писал, оставляет
        // карточку пустой — а на уроке, где такую функцию всего одна, recall
        // вместо code-шага тихо съедает практику: покрытием он считается.
        // Планировщик приходил сюда именно так: ставил в конце урока отсылку
        // «ваш compose — это стек слоёв нейросети» шагом recall.
        if (step.type === "recall" && !writtenByName.has(key(file, step.exercise_fn))) {
          errors.push(
            `Шаг ${step.id}: recall — про функцию из прошлого урока, а ${step.exercise_fn} человек ещё не писал. ` +
              `Отсылка к тому, что он написал в этом же уроке, — обычный theory-шаг`,
          );
        }
        used.add(key(file, step.exercise_fn));
      }
    }

    if (step.type !== "code") continue;

    const previous =
      step.exercise_fn && file ? writtenByName.get(key(file, step.exercise_fn)) : undefined;
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

  for (const pair of known) {
    if (!used.has(key(pair.file, pair.fn))) {
      errors.push(
        known.some((other) => other.fn === pair.fn && other.file !== pair.file)
          ? `Функция ${pair.fn} из ${pair.file} не покрыта ни одним code-шагом`
          : `Функция ${pair.fn} не покрыта ни одним code-шагом`,
      );
    }
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
