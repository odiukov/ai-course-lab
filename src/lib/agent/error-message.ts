import type { AgentRunErrorKind } from "./runner";

/**
 * Turns an `error` SSE frame into the sentence the reader shows. Lives outside
 * the client component so the mapping can be tested without a DOM: it is the
 * only place the spec's error table becomes visible text.
 */
export function errorStatus(kind: string | undefined, message: string): string {
  switch (kind as AgentRunErrorKind | undefined) {
    case "limit":
      return "Упёрлись в лимит подписки — генерация приостановлена.";
    case "spawn":
      return "Агент не найден на сервере — читать урок можно, но дописать его пока нельзя.";
    default:
      return `Ошибка: ${message}`;
  }
}
