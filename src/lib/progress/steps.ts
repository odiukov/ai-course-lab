import type { DatabaseSync } from "node:sqlite";
import type { StepMeta } from "../content/step-file";
import { execute, queryAll, queryOne } from "./db";

export type StepState = "unopened" | "read" | "failed" | "passed";

export interface StepProgress {
  stepId: string;
  state: StepState;
  openedAt: string | null;
  readAt: string | null;
}

export interface LessonProgress {
  slug: string;
  steps: StepProgress[];
  readStepIds: string[];
  resumeStepId: string | null;
}

interface StepRow {
  step_id: string;
  state: StepState;
  opened_at: string | null;
  read_at: string | null;
}

// Открытие шага только двигает opened_at вперёд и никогда не трогает
// state/read_at: URL, а не эта таблица, решает какой шаг сейчас на экране,
// а состояние read/passed один раз выставленное демонстрирует прогресс,
// который открытие того же шага снова демонстрировать не должно откатывать.
export function markStepOpened(
  db: DatabaseSync,
  slug: string,
  stepId: string,
  now: string = new Date().toISOString(),
): void {
  execute(
    db,
    `INSERT INTO step_state (lesson_slug, step_id, state, opened_at, read_at)
     VALUES (?, ?, 'unopened', ?, NULL)
     ON CONFLICT (lesson_slug, step_id) DO UPDATE SET opened_at = excluded.opened_at`,
    slug,
    stepId,
    now,
  );
}

// Отметка «прочитано» — единственное событие, которое поднимает состояние
// шага, и делает это один раз: если шаг уже failed/passed (квиз или практика
// его продвинули дальше), read сюда не откатывает назад. Повторный вызов на
// уже read-шаге не двигает read_at — читается один раз, а не «продлевается».
export function markStepRead(
  db: DatabaseSync,
  slug: string,
  stepId: string,
  now: string = new Date().toISOString(),
): void {
  execute(
    db,
    `INSERT INTO step_state (lesson_slug, step_id, state, opened_at, read_at)
     VALUES (?, ?, 'read', ?, ?)
     ON CONFLICT (lesson_slug, step_id) DO UPDATE SET
       state = CASE
         WHEN step_state.state IN ('failed', 'passed') THEN step_state.state
         ELSE 'read'
       END,
       opened_at = COALESCE(step_state.opened_at, excluded.opened_at),
       read_at = COALESCE(step_state.read_at, excluded.read_at)`,
    slug,
    stepId,
    now,
    now,
  );
}

export function readLessonProgress(db: DatabaseSync, slug: string): LessonProgress {
  const rows = queryAll<StepRow>(
    db,
    `SELECT step_id, state, opened_at, read_at
     FROM step_state WHERE lesson_slug = ? ORDER BY step_id`,
    slug,
  );

  const steps: StepProgress[] = rows.map((row) => ({
    stepId: row.step_id,
    state: row.state,
    openedAt: row.opened_at,
    readAt: row.read_at,
  }));

  // «Где мы остановились» — это последний открытый шаг, а не последний
  // прочитанный: если урок дочитан до конца, последний открытый шаг и есть
  // последний шаг плана, и открывать его снова совершенно нормально.
  const resume = queryOne<{ step_id: string }>(
    db,
    `SELECT step_id FROM step_state
     WHERE lesson_slug = ? AND opened_at IS NOT NULL
     ORDER BY opened_at DESC, step_id DESC LIMIT 1`,
    slug,
  );

  return {
    slug,
    steps,
    readStepIds: steps
      .filter((step) => step.state === "read" || step.state === "passed")
      .map((step) => step.stepId),
    resumeStepId: resume?.step_id ?? null,
  };
}

// Зелёный прогон и полностью верный квиз — единственное, что ставит passed.
// read_at при этом сохраняется, если уже был: «прочитан» и «пройден» — разные
// события, и время первого не переписывается временем второго.
export function markStepPassed(
  db: DatabaseSync,
  slug: string,
  stepId: string,
  now: string = new Date().toISOString(),
): void {
  execute(
    db,
    `INSERT INTO step_state (lesson_slug, step_id, state, opened_at, read_at)
     VALUES (?, ?, 'passed', ?, ?)
     ON CONFLICT (lesson_slug, step_id) DO UPDATE SET
       state = 'passed',
       opened_at = COALESCE(step_state.opened_at, excluded.opened_at),
       read_at = COALESCE(step_state.read_at, excluded.read_at)`,
    slug,
    stepId,
    now,
    now,
  );
}

// failed ставится безусловно, в том числе после passed: если прогон снова
// красный, значит файл снова красный, и полоска урока не должна утверждать
// обратное. read_at не трогается — прочитанным шаг быть не перестал.
export function markStepFailed(
  db: DatabaseSync,
  slug: string,
  stepId: string,
  now: string = new Date().toISOString(),
): void {
  execute(
    db,
    `INSERT INTO step_state (lesson_slug, step_id, state, opened_at, read_at)
     VALUES (?, ?, 'failed', ?, NULL)
     ON CONFLICT (lesson_slug, step_id) DO UPDATE SET
       state = 'failed',
       opened_at = COALESCE(step_state.opened_at, excluded.opened_at)`,
    slug,
    stepId,
    now,
  );
}

export function readStepIdsInPlan(
  readStepIds: readonly string[],
  steps: readonly Pick<StepMeta, "id">[],
): string[] {
  const currentIds = new Set(steps.map((step) => step.id));
  return readStepIds.filter((stepId) => currentIds.has(stepId));
}

export function readLessonReadCounts(
  db: DatabaseSync,
  stepsByLesson: ReadonlyMap<string, readonly Pick<StepMeta, "id">[]>,
): Map<string, number> {
  const rows = queryAll<{ lesson_slug: string; step_id: string }>(
    db,
    `SELECT lesson_slug, step_id FROM step_state
     WHERE state IN ('read', 'passed')`,
  );

  const currentIdsByLesson = new Map(
    [...stepsByLesson].map(([slug, steps]) => [
      slug,
      new Set(steps.map((step) => step.id)),
    ]),
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!currentIdsByLesson.get(row.lesson_slug)?.has(row.step_id)) continue;
    counts.set(row.lesson_slug, (counts.get(row.lesson_slug) ?? 0) + 1);
  }
  return counts;
}

// Внутри плана всегда найдётся индекс — кроме случая, когда шага нет вовсе
// (урок не открывали) или сохранённый resumeStepId больше не входит в план
// (план перегенерировали после правки исходника лекции, и id шагов
// сменились). Во втором случае обнулять прогресс — не единственный вариант:
// количество шагов, отмеченных прочитанными в старом плане, — разумное
// приближение к тому, где ученик остановился, потому что id шагов в проекте
// zero-padded и идут по порядку (число прочитанных шагов в старом плане и
// позиция в новом плане коррелируют, даже если конкретные id не совпали).
// Ноль остаётся ответом только тогда, когда прочитанных шагов не было вовсе —
// тут действительно ничего не известно, и открытие с нуля не рискует
// подделкой прогресса, которого не было.
export function resumeIndex(progress: LessonProgress, steps: StepMeta[]): number {
  if (!progress.resumeStepId) return 0;
  const index = steps.findIndex((step) => step.id === progress.resumeStepId);
  if (index !== -1) return index;

  if (progress.readStepIds.length === 0) return 0;
  return Math.max(0, Math.min(progress.readStepIds.length, steps.length - 1));
}
