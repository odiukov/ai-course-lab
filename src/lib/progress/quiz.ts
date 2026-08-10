import type { DatabaseSync } from "node:sqlite";
import { execute, queryAll } from "./db";

export interface QuizAttempt {
  questionIndex: number;
  answerIndex: number;
  correct: boolean;
  createdAt: string;
}

interface Row {
  question_index: number;
  answer_index: number;
  correct: number;
  created_at: string;
}

export function recordQuizAttempt(
  db: DatabaseSync,
  slug: string,
  stepId: string,
  questionIndex: number,
  answerIndex: number,
  correct: boolean,
  now: string = new Date().toISOString(),
): number {
  return execute(
    db,
    `INSERT INTO quiz_attempts (lesson_slug, step_id, question_index, answer_index, correct, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    slug,
    stepId,
    questionIndex,
    answerIndex,
    correct ? 1 : 0,
    now,
  );
}

// Попытки не перетираются: в базе лежит вся история, а «последний ответ»
// собирается чтением по порядку id — так видно и то, что человек ошибался.
export function readLatestAttempts(
  db: DatabaseSync,
  slug: string,
  stepId: string,
): Map<number, QuizAttempt> {
  const rows = queryAll<Row>(
    db,
    `SELECT question_index, answer_index, correct, created_at
     FROM quiz_attempts WHERE lesson_slug = ? AND step_id = ? ORDER BY id`,
    slug,
    stepId,
  );

  const latest = new Map<number, QuizAttempt>();
  for (const row of rows) {
    latest.set(row.question_index, {
      questionIndex: row.question_index,
      answerIndex: row.answer_index,
      correct: row.correct === 1,
      createdAt: row.created_at,
    });
  }
  return latest;
}
