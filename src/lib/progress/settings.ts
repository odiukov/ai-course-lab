import type { DatabaseSync } from "node:sqlite";
import { execute, queryOne } from "./db";

export type AgentName = "claude" | "codex";

export function isAgentName(value: unknown): value is AgentName {
  return value === "claude" || value === "codex";
}

/**
 * Выбранный агент, а если его ещё не выбирали — значение из окружения.
 *
 * Мусор в таблице приводит к тому же запасному значению, что и пустая
 * таблица: агент выбирается двумя кнопками, и единственный способ получить
 * здесь третье значение — правка базы руками. Падать из-за этого посреди
 * запроса к чату хуже, чем молча взять AGENT из .env.local.
 */
export function readAgent(db: DatabaseSync, fallback: AgentName): AgentName {
  const row = queryOne<{ value: string }>(db, "SELECT value FROM settings WHERE key = 'agent'");
  return isAgentName(row?.value) ? row.value : fallback;
}

export function writeAgent(db: DatabaseSync, agent: AgentName): void {
  execute(
    db,
    `INSERT INTO settings (key, value) VALUES ('agent', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    agent,
  );
}
