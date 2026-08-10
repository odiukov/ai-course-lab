import type { DatabaseSync } from "node:sqlite";
import { execute, queryOne } from "./db";

export interface TestRunRecord {
  id: number;
  stepId: string;
  exerciseFn: string;
  passed: number;
  failed: number;
  firstFailure: string | null;
  createdAt: string;
}

interface Row {
  id: number;
  step_id: string;
  exercise_fn: string;
  passed: number;
  failed: number;
  first_failure: string | null;
  created_at: string;
}

export function recordTestRun(
  db: DatabaseSync,
  slug: string,
  stepId: string,
  exerciseFn: string,
  outcome: { passed: number; failed: number; firstFailure: string | null },
  now: string = new Date().toISOString(),
): number {
  return execute(
    db,
    `INSERT INTO test_runs (lesson_slug, step_id, exercise_fn, passed, failed, first_failure, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    slug,
    stepId,
    exerciseFn,
    outcome.passed,
    outcome.failed,
    outcome.firstFailure,
    now,
  );
}

// Последний по id, а не по created_at: два прогона в одну миллисекунду
// сортируются по порядку вставки, и id это гарантирует.
export function lastTestRun(db: DatabaseSync, slug: string, stepId: string): TestRunRecord | null {
  const row = queryOne<Row>(
    db,
    `SELECT id, step_id, exercise_fn, passed, failed, first_failure, created_at
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
    createdAt: row.created_at,
  };
}
