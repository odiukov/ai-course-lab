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
  const run = source.exercise?.run;
  const runSteps = steps.filter((step) => step.type === "run");
  if (run && runSteps.length === 0) {
    errors.push(`У лаборатории есть script-зачёт ${run.file}, но в плане нет run-шага`);
  }
  if (runSteps.length > 1) {
    errors.push("В плане может быть только один run-шаг");
  }
  for (const step of runSteps) {
    if (!run) {
      errors.push(`Шаг ${step.id}: у упражнения нет script-зачёта`);
    } else if (!step.run_file) {
      errors.push(`Шаг ${step.id}: у run-шага нет run_file`);
    } else if (step.run_file !== run.file) {
      errors.push(`Шаг ${step.id}: запускать нужно ${run.file}, а не ${step.run_file}`);
    }
  }
  // А вот «уже написана раньше» ключуется ОДНИМ именем функции, без файла, и
  // это не небрежность. `written` собран readWrittenFunctions по ВСЕМУ курсу,
  // поэтому `item.file` — имя файла внутри ЧУЖОГО упражнения (`exercise.py` у
  // одно-файловых, `main.py` у каталожных), а сравнивать его пришлось бы с
  // именем файла ТЕКУЩЕГО. У 396 одно-файловых упражнений обе стороны
  // случайно совпадали на `exercise.py`, и пара работала по совпадению; на
  // каталожной форме она врёт в обе стороны — законный recall на функцию из
  // прошлого урока отклоняется как «человек ещё не писал», а code-шаг,
  // переучивающий её, перестаёт требовать baseline. Правда здесь — имя:
  // findPreviousImplementation в exercise/recall.ts ищет прошлую реализацию
  // ровно по нему, и валидатор обещает то же, что покажет карточка.
  //
  // Одноимённые записи из разных упражнений схлопываются в последнюю: Map
  // оставляет последнее значение, readWrittenFunctions идёт по слагам
  // (pNN-lNN-) по возрастанию, а findPreviousImplementation берёт .at(-1) —
  // то есть в сообщении об ошибке окажется тот же урок, что и в карточке.
  const writtenByName = new Map(written.map((item) => [item.fn, item]));
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
      } else if (step.exercise_file && !files.includes(step.exercise_file)) {
        // Файл существует в упражнении, но не в НЁМ объявлена эта функция —
        // ошибка другая, чем «файла нет вовсе», и человеку нужен не тот же
        // текст, а адрес, где функция на самом деле лежит.
        errors.push(
          `Шаг ${step.id}: в файле ${step.exercise_file} нет функции ${step.exercise_fn} — ` +
            `она есть в ${[...files].sort().join(", ")}`,
        );
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
          // Имя файла в сообщении имеет смысл только когда оно различает
          // задачи: у одно-файлового упражнения (files.length === 1) файл
          // один и подразумевается, и текст ошибки остаётся тем же, что и
          // до пары «файл + функция» — тем же принципом, что и у сообщения
          // о непокрытой функции ниже.
          errors.push(
            files.length > 1
              ? `Шаг ${step.id}: функция ${step.exercise_fn} в ${file} уже занята другим шагом`
              : `Шаг ${step.id}: функция ${step.exercise_fn} уже занята другим шагом`,
          );
        }
        // recall обещает карточку «вот как ты написал это в прошлый раз», и
        // прошлый раз ищется по ДРУГИМ упражнениям курса (findPreviousImplementation
        // исключает текущее). Функция, которую человек ещё не писал, оставляет
        // карточку пустой — а на уроке, где такую функцию всего одна, recall
        // вместо code-шага тихо съедает практику: покрытием он считается.
        // Планировщик приходил сюда именно так: ставил в конце урока отсылку
        // «ваш compose — это стек слоёв нейросети» шагом recall.
        if (step.type === "recall" && !writtenByName.has(step.exercise_fn)) {
          errors.push(
            `Шаг ${step.id}: recall — про функцию из прошлого урока, а ${step.exercise_fn} человек ещё не писал. ` +
              `Отсылка к тому, что он написал в этом же уроке, — обычный theory-шаг`,
          );
        }
        used.add(key(file, step.exercise_fn));
      }
    }

    if (step.type !== "code") continue;

    // `file` в условии — не часть ключа (ключ здесь один, имя функции), а
    // признак того, что адрес шага прошёл проверки выше: у шага с неизвестной
    // или неоднозначной функцией ошибка уже названа, и вторая — «функция уже
    // написана» — говорила бы о задаче, адреса которой мы не знаем.
    const previous = step.exercise_fn && file ? writtenByName.get(step.exercise_fn) : undefined;
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

  if (run && runSteps.length === 1) {
    const runIndex = steps.indexOf(runSteps[0]);
    const lastPracticeIndex = steps.reduce(
      (last, step, index) => (step.type === "code" || step.type === "recall" ? index : last),
      -1,
    );
    if (runIndex < lastPracticeIndex) {
      errors.push(`Шаг ${runSteps[0].id}: итоговый запуск должен стоять после всех code-шагов`);
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
