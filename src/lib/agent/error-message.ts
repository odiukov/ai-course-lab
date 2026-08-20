import type { AgentRunErrorKind } from "./runner";

/**
 * Turns an `error` SSE frame into the sentence the user sees. Lives outside the
 * client components so the mapping can be tested without a DOM: it is the only
 * place the spec's error table becomes visible text.
 *
 * The wording is deliberately neutral about *what* was running, because both
 * streaming surfaces share it: step generation and the step chat. A sentence
 * naming only generation would be wrong half the time.
 */
export function errorStatus(kind: string | undefined, message: string): string {
  switch (kind as AgentRunErrorKind | undefined) {
    case "limit":
      return "Упёрлись в лимит подписки — очередь встала на паузу, попробуй позже.";
    case "spawn":
      return "Агент не найден на сервере — читать урок можно, а дописывать и спрашивать пока нет.";
    case "timeout":
      return "Агент не ответил вовремя — запуск прерван. Попробуй ещё раз.";
    case "aborted":
      return "Запуск агента отменён.";
    default:
      return `Ошибка: ${message}`;
  }
}

/**
 * Ошибка ли это исчерпанного лимита — того, что лечится только временем или
 * поднятой квотой.
 *
 * Отличать её от прочих обязательно: длинная очередь фаз после исчерпания
 * лимита не встаёт, а прогорает вхолостую — каждый следующий урок падает на
 * первом же обращении к агенту и остаётся помечен провалом, хотя попытки, по
 * сути, не было.
 *
 * Проверка структурная, без instanceof: этот модуль тянут за собой клиентские
 * компоненты, а `AgentRunError` живёт в runner.ts рядом с child_process, и
 * значение оттуда утащило бы серверный код в браузерный бандл. Текст ловится
 * тоже: CLI сообщает про лимит трат обычным `error`-кадром, без kind: "limit".
 */
const LIMIT_TEXT = /spend limit|usage limit|hit your .*limit|limit reached|usage-credits|лимит подписки|лимит трат/i;

export function isLimitError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { kind?: unknown }).kind === "limit") return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && LIMIT_TEXT.test(message);
}

/**
 * Ошибка ли это оборванного по таймауту запуска.
 *
 * Один такой — случайность, серия подряд — упавшая сеть. Отличать нужно затем,
 * что молотить дальше в этом случае бессмысленно: очередь фаз за пять часов
 * простоя пометила провалом семнадцать уроков, к которым попытки не было.
 */
const TIMEOUT_TEXT = /не ответил за \d+ с/i;

export function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { kind?: unknown }).kind === "timeout") return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && TIMEOUT_TEXT.test(message);
}

/**
 * Поломка ли это временная — из тех, что лечатся повтором через минуту.
 *
 * Провайдер отвечает «529 Overloaded» или обрывает поток на полуслове; ни то,
 * ни другое не про этот урок и не про этот промпт. Один шаг такой ошибки
 * отменял весь урок целиком: из 33 шагов на диске оставалось два, и урок
 * приходилось прогонять ещё раз отдельным проходом.
 */
const TRANSIENT_TEXT =
  /\b(429|500|502|503|529)\b|overloaded|stopped arriving|try again|temporarily|connection error|ECONNRESET|ETIMEDOUT/i;

export function isTransientError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  // Лимит тоже «временный», но повтор через минуту его не лечит: очередь на
  // нём обязана встать, а не молотить.
  if (isLimitError(error)) return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && TRANSIENT_TEXT.test(message);
}
