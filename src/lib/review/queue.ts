import type { CardState } from "./scheduler";

export interface QueueCard {
  lessonSlug: string;
  cardId: string;
}

export interface QueueLimits {
  newPerDay: number;
  sessionCap: number;
}

/**
 * Лимиты не косметические.
 *
 * Без них человек, прошедший десять уроков, получает на утро триста вопросов
 * и не открывает страницу больше никогда. Сорок карточек по пятнадцать секунд
 * — это десять минут, столько подход и должен занимать.
 */
export const DEFAULT_LIMITS: QueueLimits = { newPerDay: 10, sessionCap: 40 };

export function stateKey(card: QueueCard): string {
  return `${card.lessonSlug}/${card.cardId}`;
}

/**
 * Очередь на сегодня.
 *
 * Просроченные впереди, дольше всех ждущие — первыми: у карточки, забытой на
 * месяц, шанс вспомнить падает с каждым днём, и она должна успеть попасть в
 * подход до того, как упрётся в потолок.
 *
 * Новые не сваливаются в хвост, а подмешиваются равномерно: подход, где первые
 * тридцать карточек знакомые, а последние десять новые, ощущается как две
 * разные задачи подряд.
 */
export function buildQueue(
  cards: QueueCard[],
  states: Record<string, CardState>,
  today: string,
  limits: QueueLimits = DEFAULT_LIMITS,
): QueueCard[] {
  const seen: { card: QueueCard; dueOn: string }[] = [];
  const fresh: QueueCard[] = [];

  for (const card of cards) {
    const state = states[stateKey(card)];
    if (!state) {
      fresh.push(card);
      continue;
    }
    if (state.dueOn <= today) seen.push({ card, dueOn: state.dueOn });
  }

  seen.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));

  const dueCards = seen.map((item) => item.card).slice(0, limits.sessionCap);
  const newCards = fresh.slice(0, Math.min(limits.newPerDay, limits.sessionCap - dueCards.length));

  return interleave(dueCards, newCards, limits.sessionCap);
}

/** Раскладывает новые карточки равными промежутками между знакомыми. */
function interleave(due: QueueCard[], fresh: QueueCard[], cap: number): QueueCard[] {
  if (!fresh.length) return due.slice(0, cap);
  if (!due.length) return fresh.slice(0, cap);

  const result: QueueCard[] = [];
  const step = due.length / fresh.length;
  let nextFresh = 0;

  due.forEach((card, index) => {
    while (nextFresh < fresh.length && index >= step * nextFresh) {
      result.push(fresh[nextFresh]);
      nextFresh += 1;
    }
    result.push(card);
  });
  result.push(...fresh.slice(nextFresh));

  return result.slice(0, cap);
}
