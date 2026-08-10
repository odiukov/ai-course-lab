import type { DatabaseSync } from "node:sqlite";
import { execute, queryOne } from "./db";

export interface TestRunRecord {
  id: number;
  stepId: string;
  exerciseFn: string;
  passed: number;
  failed: number;
  firstFailure: string | null;
  /** Гонялся только набор этой функции, а не весь файл упражнения. */
  filtered: boolean;
  /** Предупреждение раннера (фильтр не выбрал ничего) — дословно, как показали учащемуся. */
  warning: string | null;
  createdAt: string;
}

interface Row {
  id: number;
  step_id: string;
  exercise_fn: string;
  passed: number;
  failed: number;
  first_failure: string | null;
  filtered: number;
  warning: string | null;
  created_at: string;
}

export interface TestRunOutcome {
  passed: number;
  failed: number;
  firstFailure: string | null;
  filtered: boolean;
  warning: string | null;
}

export function recordTestRun(
  db: DatabaseSync,
  slug: string,
  stepId: string,
  exerciseFn: string,
  outcome: TestRunOutcome,
  now: string = new Date().toISOString(),
): number {
  return execute(
    db,
    `INSERT INTO test_runs
       (lesson_slug, step_id, exercise_fn, passed, failed, first_failure, filtered, warning, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    slug,
    stepId,
    exerciseFn,
    outcome.passed,
    outcome.failed,
    outcome.firstFailure,
    outcome.filtered ? 1 : 0,
    outcome.warning,
    now,
  );
}

// Последний по id, а не по created_at: два прогона в одну миллисекунду
// сортируются по порядку вставки, и id это гарантирует.
export function lastTestRun(db: DatabaseSync, slug: string, stepId: string): TestRunRecord | null {
  const row = queryOne<Row>(
    db,
    `SELECT id, step_id, exercise_fn, passed, failed, first_failure, filtered, warning, created_at
     FROM test_runs WHERE lesson_slug = ? AND step_id = ? ORDER BY id DESC LIMIT 1`,
    slug,
    stepId,
  );
  if (!row) return null;
  return {
    id: row.id,
    stepId: row.step_id,
    exerciseFn: row.exercise_fn,
    passed: row.passed,
    failed: row.failed,
    firstFailure: row.first_failure,
    filtered: row.filtered === 1,
    warning: row.warning,
    createdAt: row.created_at,
  };
}
