/**
 * SM-2 одной чистой функцией.
 *
 * Сегодняшняя дата приходит аргументом, а не читается из Date.now(): иначе
 * тест на карточку, просроченную на сорок дней, требовал бы подмены системного
 * времени, а страница не смогла бы показать «что будет через неделю».
 */

export type Grade = "again" | "hard" | "good" | "easy";

export interface CardState {
  intervalDays: number;
  ease: number;
  /** Успешные повторения подряд; `again` обнуляет. */
  reps: number;
  lapses: number;
  /** ISO-дата без времени. */
  dueOn: string;
}

const START_EASE = 2.5;

/**
 * Пол лёгкости.
 *
 * Не косметика: без него карточка, на которой человек ошибается пять раз
 * подряд, получает множитель меньше единицы, и её интервал начинает
 * сокращаться с каждым успешным ответом — ровно наоборот тому, что нужно.
 */
const MIN_EASE = 1.3;

const EASE_DELTA: Record<Grade, number> = {
  again: -0.2,
  hard: -0.15,
  good: 0,
  easy: 0.1,
};

/** Первые два успеха идут по фиксированной лестнице, дальше работает ease. */
const FIRST_INTERVALS = [1, 6];

export function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export function newCardState(today: string): CardState {
  return { intervalDays: 0, ease: START_EASE, reps: 0, lapses: 0, dueOn: today };
}

function nextInterval(state: CardState, grade: Grade): number {
  if (grade === "again") return 1;
  if (state.reps < FIRST_INTERVALS.length) return FIRST_INTERVALS[state.reps];

  const factor = grade === "hard" ? 1.2 : grade === "easy" ? state.ease * 1.3 : state.ease;
  return Math.max(1, Math.round(state.intervalDays * factor));
}

export function schedule(state: CardState, grade: Grade, today: string): CardState {
  const ease = Math.max(MIN_EASE, state.ease + EASE_DELTA[grade]);
  const intervalDays = nextInterval(state, grade);

  return {
    intervalDays,
    ease,
    reps: grade === "again" ? 0 : state.reps + 1,
    lapses: grade === "again" ? state.lapses + 1 : state.lapses,
    // Срок считается от сегодня, а не от прежнего dueOn: карточка,
    // пролежавшая просроченной месяц, иначе получила бы срок в прошлом.
    dueOn: addDays(today, intervalDays),
  };
}
