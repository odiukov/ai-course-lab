import type { DatabaseSync } from "node:sqlite";
import { execute, queryAll, queryOne } from "./db";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: number;
  role: ChatRole;
  text: string;
  createdAt: string;
  kept: boolean;
}

export interface ChatSession {
  id: number;
  slug: string;
  stepId: string;
  createdAt: string;
  messages: ChatMessage[];
}

// Верхняя граница символов, которую formatHistory отдаёт наружу: это то, что
// уходит в промпт модели, а не то, что хранится в базе — в базе реплики не
// урезаются никогда. Значение с запасом меньше типичного окна контекста и
// не задано в брифе явно, поэтому выбрано по тому же принципу, что и внутри
// самого formatHistory: разумный дефолт, а не произвольное число.
export const MAX_HISTORY_CHARS = 2000;

// Сколько последних реплик recentHistory берёт, если вызывающий код не
// попросил конкретное количество. Бриф не называет число — 6 реплик (по
// три пары «вопрос-ответ») подобрано так, чтобы formatHistory почти никогда
// не должен было резать текст с начала при обычных, не гигантских репликах.
const DEFAULT_HISTORY_LIMIT = 6;

interface MessageRow {
  id: number;
  role: ChatRole;
  text: string;
  created_at: string;
  kept: number;
}

interface SessionRow {
  id: number;
  lesson_slug: string;
  step_id: string;
  created_at: string;
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    createdAt: row.created_at,
    kept: row.kept === 1,
  };
}

// Чат на шаге — одна непрерывная беседа: повторное открытие того же (урок,
// шаг) переиспользует уже существующую сессию, а не заводит новую при каждом
// заходе на страницу.
export function openChatSession(
  db: DatabaseSync,
  slug: string,
  stepId: string,
  now: string = new Date().toISOString(),
): number {
  const existing = queryOne<{ id: number }>(
    db,
    `SELECT id FROM chat_sessions WHERE lesson_slug = ? AND step_id = ? ORDER BY id DESC LIMIT 1`,
    slug,
    stepId,
  );
  if (existing) return existing.id;

  return execute(
    db,
    `INSERT INTO chat_sessions (lesson_slug, step_id, created_at) VALUES (?, ?, ?)`,
    slug,
    stepId,
    now,
  );
}

export function addChatMessage(
  db: DatabaseSync,
  sessionId: number,
  role: ChatRole,
  text: string,
  now: string = new Date().toISOString(),
): number {
  return execute(
    db,
    `INSERT INTO chat_messages (session_id, role, text, created_at, kept) VALUES (?, ?, ?, ?, 0)`,
    sessionId,
    role,
    text,
    now,
  );
}

// Порядок реплик держится на autoincrement id (ORDER BY id), а не на
// created_at: несколько сообщений, вставленных в один и тот же миллисекунд
// (или явно с одинаковым `now`), всё равно возвращаются в порядке вставки,
// потому что id монотонно растёт при каждой INSERT независимо от таймстампа.
export function readChatSession(db: DatabaseSync, sessionId: number): ChatSession | null {
  const session = queryOne<SessionRow>(
    db,
    `SELECT id, lesson_slug, step_id, created_at FROM chat_sessions WHERE id = ?`,
    sessionId,
  );
  if (!session) return null;

  const messages = queryAll<MessageRow>(
    db,
    `SELECT id, role, text, created_at, kept FROM chat_messages WHERE session_id = ? ORDER BY id`,
    sessionId,
  ).map(toMessage);

  return {
    id: session.id,
    slug: session.lesson_slug,
    stepId: session.step_id,
    createdAt: session.created_at,
    messages,
  };
}

export function findChatSession(
  db: DatabaseSync,
  slug: string,
  stepId: string,
): ChatSession | null {
  const found = queryOne<{ id: number }>(
    db,
    `SELECT id FROM chat_sessions WHERE lesson_slug = ? AND step_id = ? ORDER BY id DESC LIMIT 1`,
    slug,
    stepId,
  );
  return found ? readChatSession(db, found.id) : null;
}

// То, что уходит в промпт модели: старые реплики первыми, свежие последними,
// и ограничено количеством — long conversation нельзя целиком вставить в
// промпт. Сортировка та же самая (по id), поэтому DESC+LIMIT+reverse даёт
// «последние N в хронологическом порядке», а не «последние N в обратном».
export function recentHistory(
  db: DatabaseSync,
  sessionId: number,
  limit = DEFAULT_HISTORY_LIMIT,
): ChatMessage[] {
  const rows = queryAll<MessageRow>(
    db,
    `SELECT id, role, text, created_at, kept FROM chat_messages
     WHERE session_id = ? ORDER BY id DESC LIMIT ?`,
    sessionId,
    limit,
  );
  return rows.reverse().map(toMessage);
}

// Пометка «оставить в теории» ставится отдельным шагом (планом это уже не
// покрывается — эту реплику потом читает содержимое из content/clarifications.ts,
// но само превращение в markdown-файл клиффхенгера — задача другого модуля;
// здесь только флаг на конкретной реплике этого чата).
export function markMessageKept(db: DatabaseSync, messageId: number): void {
  execute(db, `UPDATE chat_messages SET kept = 1 WHERE id = ?`, messageId);
}

// Схлопывает историю в один текстовый блок для промпта. Режет с начала (со
// старых реплик), потому что свежие важнее для контекста следующего ответа.
// Если даже одна последняя реплика длиннее лимита, она не выбрасывается
// целиком — обрезается посимвольно, чтобы модель получила хоть что-то из
// самого недавнего сообщения, а не пустую историю.
export function formatHistory(messages: ChatMessage[]): string {
  if (messages.length === 0) return "(это первый вопрос в этом чате)";

  const lines = messages.map(
    (message) => `${message.role === "user" ? "Ученик" : "Ты"}: ${message.text}`,
  );

  const kept: string[] = [];
  let used = 0;
  for (const line of [...lines].reverse()) {
    if (used + line.length > MAX_HISTORY_CHARS) break;
    kept.unshift(line);
    used += line.length;
  }
  if (kept.length === 0) {
    return `${lines[lines.length - 1].slice(0, MAX_HISTORY_CHARS - 1)}…`;
  }
  return kept.join("\n");
}
