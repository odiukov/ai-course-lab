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

/**
 * Раскладывает два списка друг в друга равномерно.
 *
 * Слияние симметрично намеренно. Прежний вариант шагал по индексам знакомых
 * карточек и потому умел разложить новые только тогда, когда знакомых не
 * меньше; при одной знакомой и десяти новых остаток сваливался в хвост одним
 * куском. Здесь каждый шаг берёт карточку из того списка, чья следующая доля
 * ближе к началу, и оба списка расходятся по подходу ровно, кого бы ни было
 * больше.
 */
function interleave(due: QueueCard[], fresh: QueueCard[], cap: number): QueueCard[] {
  if (!fresh.length) return due.slice(0, cap);
  if (!due.length) return fresh.slice(0, cap);

  const result: QueueCard[] = [];
  let takenDue = 0;
  let takenFresh = 0;

  while (takenDue < due.length || takenFresh < fresh.length) {
    // Доля считается по середине отрезка карточки: (2k + 1) / 2n. Сравнение
    // умножением, а не делением, чтобы порядок не зависел от округления.
    const dueAhead =
      takenDue < due.length &&
      (takenFresh >= fresh.length ||
        (2 * takenDue + 1) * fresh.length <= (2 * takenFresh + 1) * due.length);

    if (dueAhead) {
      result.push(due[takenDue]);
      takenDue += 1;
    } else {
      result.push(fresh[takenFresh]);
      takenFresh += 1;
    }
  }

  return result.slice(0, cap);
}
