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
