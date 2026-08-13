import type { Step, StepMeta } from "../content/step-file";
import { stepAnchor } from "./anchors";
import { quizQuestions, type QuizQuestion } from "./quiz";

export interface LessonBlock {
  step: Step;
  /** Человеческий номер шага в плане, с единицы. */
  number: number;
  anchor: string;
  visualHref: string | null;
  questions: QuizQuestion[];
  practiceFn: string | null;
}

export interface LessonModel {
  slug: string;
  title: string;
  /** Полный порядок плана — по нему ссылки на шаги находят свои якоря. */
  stepIds: string[];
  blocks: LessonBlock[];
  plannedCount: number;
  writtenCount: number;
}

export interface BuildLessonModelOptions {
  slug: string;
  title: string;
  steps: StepMeta[];
  /** Прочитанные с диска шаги, ключ — id шага плана. */
  written: Record<string, Step>;
  visualHrefByStepId: Record<string, string>;
}

/**
 * Собирает страницу урока из плана и того, что реально написано.
 *
 * Номер блока берётся из позиции в ПЛАНЕ, а не из порядка написанных шагов:
 * урок дописывается параллельно, и ненаписанный шаг посреди плана — норма.
 * Сдвинь нумерацию — и все ссылки «см. шаг N» в соседних шагах начнут
 * показывать не туда.
 *
 * Функция чистая: ничего не читает с диска, всё приходит аргументами.
 */
export function buildLessonModel(options: BuildLessonModelOptions): LessonModel {
  const { slug, title, steps, written, visualHrefByStepId } = options;
  const blocks: LessonBlock[] = [];

  steps.forEach((meta, position) => {
    const step = written[meta.id];
    if (!step) return;

    blocks.push({
      step,
      number: position + 1,
      anchor: stepAnchor(meta.id),
      visualHref: visualHrefByStepId[meta.id] ?? null,
      questions: quizQuestions(step),
      practiceFn: step.exercise_fn ?? null,
    });
  });

  return {
    slug,
    title,
    stepIds: steps.map((meta) => meta.id),
    blocks,
    plannedCount: steps.length,
    writtenCount: blocks.length,
  };
}
