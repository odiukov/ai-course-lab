// Разбор урока целиком: упражнение, план, шаги.
//
// Живёт отдельно от маршрута, потому что вызывающих двое: HTTP-маршрут, который
// шлёт ход работы в SSE, и scripts/write-lesson.mts, который печатает его в
// терминал. У скрипта своя очередь агента (queue.ts держит её в модуле, то есть
// на процесс), и это единственный способ писать урок параллельно тому, что уже
// пишет dev-сервер.
import type { AgentEvent } from "../agent/events";
import type { Config } from "../config";
import { isStale, readLessonPlan, type LessonPlan } from "../content/lesson-plan";
import { readPhaseOutlines, readPreviousPhases } from "../content/phase-outlines";
import { runTests } from "../practice/run-tests";
import { findLesson } from "../source/catalog";
import { readLessonSource } from "../source/lesson-source";
import { readWrittenFunctions } from "../source/written-functions";
import { generateLessonPlan, type GenerateDeps } from "./plan-lesson";
import { generateExercise } from "./write-exercise";
import { ensureSteps } from "./write-step";

export type BuildStage = "exercise" | "plan" | "steps";

export interface BuildLessonOptions {
  config: Config;
  slug: string;
  /** С какого шага плана начинать. */
  fromIndex: number;
  /**
   * Дописать урок до конца, а не окно вперёд читателя.
   *
   * Каталог просит именно это: разбор там запускают один раз и уходят, поэтому
   * окно из трёх шагов оставило бы урок недописанным до первого открытия.
   */
  all: boolean;
  deps: GenerateDeps;
  onProgress?: (stage: BuildStage, text: string) => void;
  onPlan?: (plan: LessonPlan) => void;
  /**
   * Поломка, которая не отменяет разбор: не написалось упражнение, не
   * нарисовалась схема. Урок без картинки читается, без текста — нет.
   */
  onSoftError?: (message: string) => void;
  onEvent?: (event: AgentEvent) => void;
}

export async function buildLesson(opts: BuildLessonOptions): Promise<string[]> {
  const { config, slug, deps } = opts;
  const progress = opts.onProgress ?? (() => {});
  const softError = opts.onSoftError ?? (() => {});

  const ref = findLesson(config.sourceDir, slug);
  if (!ref) throw new Error("Урок не найден");
  let source = readLessonSource(config.sourceDir, ref);

  // Упражнения есть не у каждого урока курса. Без него планировщик получает
  // «(нет упражнения)» и строит урок вообще без code-шагов, то есть без
  // практики — поэтому упражнение придумывается ДО плана, чтобы функции
  // попали планировщику наравне с готовыми.
  if (!source.exercise) {
    progress("exercise", "Придумываю упражнение к уроку");
    const made = await generateExercise({
      sourceDir: config.sourceDir,
      source,
      deps,
      written: readWrittenFunctions(config.sourceDir),
      check: async (dir) => {
        const outcome = await runTests({ dir, python: config.python });
        if (outcome.passed > 0 && outcome.failed === 0 && outcome.errors === 0) return null;
        const first = outcome.failures[0];
        return first
          ? `${first.name}: ${first.message}`
          : `прошло ${outcome.passed}, упало ${outcome.failed}, ошибок ${outcome.errors}`;
      },
    });

    if ("error" in made) {
      softError(`Упражнение к уроку не написалось: ${made.error}`);
    } else {
      source = readLessonSource(config.sourceDir, ref);
    }
  }

  let plan = readLessonPlan(config.contentDir, slug);
  if (!plan || isStale(plan, source)) {
    progress("plan", "Составляю план урока");
    plan = await generateLessonPlan({
      contentDir: config.contentDir,
      source,
      deps,
      written: readWrittenFunctions(config.sourceDir),
      outlines: readPhaseOutlines(config.contentDir, slug),
      previousPhases: readPreviousPhases(config.contentDir, slug),
    });
    opts.onPlan?.(plan);
  }

  progress("steps", "Пишу шаги");
  return ensureSteps({
    contentDir: config.contentDir,
    source,
    plan,
    fromIndex: opts.fromIndex,
    count: opts.all ? plan.steps.length : undefined,
    deps,
    onEvent: opts.onEvent,
    // Ход работы — это «что пишется сейчас», а не поток текста от агента: его
    // хвост обрывается посреди формулы и читается как мусор.
    onStep: ({ number, total, title }) =>
      progress("steps", `Пишу шаг ${number} из ${total}: ${title}`),
    onVisualError: (stepId, problem) =>
      softError(`Схему для шага ${stepId} нарисовать не удалось: ${problem}`),
  });
}
