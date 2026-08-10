import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SqlParam = string | number | null;

// Пять таблиц, а не четыре из спеки: сессии чата разложены на chat_sessions и
// chat_messages. Складывать реплики в одну колонку JSON-ом означает лишиться
// возможности пометить одну конкретную реплику как «оставленную в теории» и
// достать последние N сообщений запросом, а именно это и нужно чату.
//
// quiz_attempts и test_runs создаются здесь, но ничего в план 2 их не
// заполняет — их пишет план 3 (редактор и UI квиза). Это осознанное решение,
// не забытый кусок: схема для прогресса нужна вся сразу, а UI, который её
// использует, приезжает по частям.
//
// node:sqlite не принимает булевы значения параметров («Provided value
// cannot be bound to SQLite parameter»), поэтому все флаги — INTEGER 0/1,
// и это закреплено CHECK-ограничениями.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS step_state (
  lesson_slug TEXT NOT NULL,
  step_id     TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('unopened', 'read', 'failed', 'passed')),
  opened_at   TEXT,
  read_at     TEXT,
  PRIMARY KEY (lesson_slug, step_id)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_slug    TEXT NOT NULL,
  step_id        TEXT NOT NULL,
  question_index INTEGER NOT NULL,
  answer_index   INTEGER NOT NULL,
  correct        INTEGER NOT NULL CHECK (correct IN (0, 1)),
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_slug   TEXT NOT NULL,
  step_id       TEXT NOT NULL,
  exercise_fn   TEXT NOT NULL,
  passed        INTEGER NOT NULL,
  failed        INTEGER NOT NULL,
  first_failure TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_slug TEXT NOT NULL,
  step_id     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  kept       INTEGER NOT NULL DEFAULT 0 CHECK (kept IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_step_state_lesson ON step_state (lesson_slug);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_step ON chat_sessions (lesson_slug, step_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (session_id, id);
`;

// Одно соединение на директорию данных: route handlers вызываются на каждый
// запрос, и открывать файл заново каждый раз незачем. Ключ — абсолютный путь к
// файлу базы, поэтому тесты с разными временными директориями не мешают друг
// другу. Для локального однопользовательского приложения это безопасно: один
// процесс Next.js, один файл, WAL-режим и один держатель хендла на файл —
// никакой конкуренции между процессами, которую нужно было бы разруливать.
const connections = new Map<string, DatabaseSync>();

export function openProgressDb(dataDir: string): DatabaseSync {
  const file = path.join(path.resolve(dataDir), "progress.db");
  const existing = connections.get(file);
  if (existing) return existing;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  connections.set(file, db);
  return db;
}

export function closeProgressDb(dataDir: string): void {
  const file = path.join(path.resolve(dataDir), "progress.db");
  const db = connections.get(file);
  if (!db) return;
  db.close();
  connections.delete(file);
}

// Типы node:sqlite описывают результаты как union скалярных значений; каждая
// выборка здесь знает форму своей строки, поэтому приведение делается один раз
// в этих трёх обёртках, а не рассыпается по всем запросам.
export function queryOne<T>(db: DatabaseSync, sql: string, ...params: SqlParam[]): T | null {
  const row = db.prepare(sql).get(...(params as unknown as never[]));
  return (row ?? null) as T | null;
}

export function queryAll<T>(db: DatabaseSync, sql: string, ...params: SqlParam[]): T[] {
  return db.prepare(sql).all(...(params as unknown as never[])) as unknown as T[];
}

export function execute(db: DatabaseSync, sql: string, ...params: SqlParam[]): number {
  const result = db.prepare(sql).run(...(params as unknown as never[]));
  return Number(result.lastInsertRowid);
}
