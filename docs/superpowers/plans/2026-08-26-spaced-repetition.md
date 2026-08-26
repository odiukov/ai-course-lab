# Spaced Repetition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать читателю опубликованного сайта страницу `/review/`, которая каждый день показывает очередь карточек, готовых к повторению, принимает ответ и назначает следующий срок по SM-2.

**Architecture:** Вся логика — чистые функции в `src/lib/review/`, принимающие сегодняшнюю дату аргументом; с браузером, сетью и хранилищем разговаривает только бандл `src/site-review/`, собираемый esbuild-ом по образцу `src/site-search/`. Состояние графика живёт в `localStorage` у гостя и в четвёртой таблице Supabase у вошедшего, сливаясь при первом входе через существующий `src/lib/sync/merge.ts`.

**Tech Stack:** TypeScript, esbuild, vitest + happy-dom, Supabase (postgres + RLS), zod.

**Spec:** `docs/superpowers/specs/2026-08-25-spaced-repetition-design.md`

## Global Constraints

- `schedule` и `buildQueue` принимают сегодняшнюю дату аргументом (ISO-дата без
  времени, `YYYY-MM-DD`), а не читают `Date.now()`.
- SM-2 числами: `ease` стартует с 2.5, пол 1.3; изменение по оценке — `again`
  −0.20, `hard` −0.15, `good` 0, `easy` +0.10; первые два успешных повторения
  дают фиксированные интервалы 1 и 6 дней; дальше интервал умножается на 1.2
  (`hard`), на `ease` (`good`), на `ease` × 1.3 (`easy`); `again` ставит интервал
  в 1 день, обнуляет счётчик фиксированных интервалов и увеличивает `lapses`.
- Лимиты по умолчанию: 10 новых карточек в день, потолок 40 за подход.
- Оценки: `"again" | "hard" | "good" | "easy"`. У `open` человеку доступны три
  кнопки — `again`, `hard`, `easy`; `good` для него недоступна намеренно.
- Правило слияния: побеждает свежая по `updatedAt`; при равенстве побеждает та,
  у которой `intervalDays` **меньше**. Расхождение `fingerprint` отбрасывает
  состояние с обеих сторон.
- Ключ `localStorage`: `course-review:<lesson-slug>`, значение — объект
  `{ "<card-id>": CardState }`.
- Карточки едут по файлу на урок: `cards/<slug>.json`, плюс манифест
  `cards/index.json`.
- Отладочный сдвиг дня включается параметром адреса `?debug=1`.
- Комментарии в коде — по-русски, объясняют причину решения, а не строку.
- Коммиты — по-английски (`feat:`, `fix:`, `refactor:`, `docs:`).
- Тесты гоняются через `npx vitest run <путь>`.

---

### Task 1: Планировщик SM-2

**Files:**
- Create: `src/lib/review/scheduler.ts`
- Test: `src/lib/review/scheduler.test.ts`

**Interfaces:**
- Produces:
  - `type Grade = "again" | "hard" | "good" | "easy"`
  - `interface CardState { intervalDays: number; ease: number; reps: number; lapses: number; dueOn: string }`
  - `function newCardState(today: string): CardState`
  - `function schedule(state: CardState, grade: Grade, today: string): CardState`
  - `function addDays(date: string, days: number): string`

- [ ] **Step 1: Написать падающие тесты**

Создать `src/lib/review/scheduler.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addDays, newCardState, schedule, type CardState } from "./scheduler";

const TODAY = "2026-08-26";

function state(over: Partial<CardState> = {}): CardState {
  return { intervalDays: 0, ease: 2.5, reps: 0, lapses: 0, dueOn: TODAY, ...over };
}

describe("addDays", () => {
  it("считает дату вперёд", () => {
    expect(addDays("2026-08-26", 6)).toBe("2026-09-01");
  });

  it("переходит через границу года", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});

describe("schedule — первые повторения", () => {
  it("первый успех даёт интервал в один день", () => {
    const next = schedule(state(), "good", TODAY);
    expect(next.intervalDays).toBe(1);
    expect(next.dueOn).toBe("2026-08-27");
    expect(next.reps).toBe(1);
  });

  it("второй успех даёт шесть дней", () => {
    const next = schedule(state({ intervalDays: 1, reps: 1 }), "good", "2026-08-27");
    expect(next.intervalDays).toBe(6);
    expect(next.dueOn).toBe("2026-09-02");
  });

  it("третий успех умножает интервал на лёгкость", () => {
    const next = schedule(state({ intervalDays: 6, reps: 2 }), "good", "2026-09-02");
    expect(next.intervalDays).toBe(15);
    expect(next.ease).toBe(2.5);
  });
});

describe("schedule — оценки", () => {
  it("hard растит интервал в 1.2 раза и снижает лёгкость", () => {
    const next = schedule(state({ intervalDays: 10, reps: 3 }), "hard", TODAY);
    expect(next.intervalDays).toBe(12);
    expect(next.ease).toBeCloseTo(2.35, 5);
  });

  it("easy растит интервал в ease × 1.3 и поднимает лёгкость", () => {
    const next = schedule(state({ intervalDays: 10, reps: 3 }), "easy", TODAY);
    expect(next.intervalDays).toBe(33);
    expect(next.ease).toBeCloseTo(2.6, 5);
  });

  it("again сбрасывает интервал в день, считает провал и роняет лёгкость на 0.2", () => {
    const next = schedule(state({ intervalDays: 30, reps: 5, lapses: 1 }), "again", TODAY);
    expect(next.intervalDays).toBe(1);
    expect(next.reps).toBe(0);
    expect(next.lapses).toBe(2);
    expect(next.ease).toBeCloseTo(2.3, 5);
  });
});

describe("schedule — пол лёгкости", () => {
  it("не опускает ease ниже 1.3, сколько бы раз ни ошибались", () => {
    let current = state({ intervalDays: 5, reps: 2 });
    for (let i = 0; i < 12; i += 1) current = schedule(current, "again", TODAY);
    expect(current.ease).toBe(1.3);
  });

  it("при поле 1.3 интервал всё равно растёт, а не сокращается", () => {
    const next = schedule(state({ intervalDays: 10, reps: 3, ease: 1.3 }), "good", TODAY);
    expect(next.intervalDays).toBeGreaterThan(10);
  });
});

describe("schedule — просроченная карточка", () => {
  it("считает следующий срок от сегодня, а не от старого dueOn", () => {
    const overdue = state({ intervalDays: 6, reps: 2, dueOn: "2026-07-17" });
    const next = schedule(overdue, "good", TODAY);
    expect(next.dueOn).toBe(addDays(TODAY, next.intervalDays));
  });
});

describe("newCardState", () => {
  it("новая карточка готова сегодня и не имеет истории", () => {
    expect(newCardState(TODAY)).toEqual({
      intervalDays: 0,
      ease: 2.5,
      reps: 0,
      lapses: 0,
      dueOn: TODAY,
    });
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run src/lib/review/scheduler.test.ts`
Expected: FAIL, `Failed to resolve import "./scheduler"`.

- [ ] **Step 3: Написать `src/lib/review/scheduler.ts`**

```ts
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
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run src/lib/review/scheduler.test.ts`
Expected: PASS, 12 тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/review/scheduler.ts src/lib/review/scheduler.test.ts
git commit -m "feat(review): add the SM-2 scheduler as a pure function"
```

---

### Task 2: Очередь на день и перевод ответа в оценку

**Files:**
- Create: `src/lib/review/queue.ts`, `src/lib/review/grade.ts`
- Test: `src/lib/review/queue.test.ts`, `src/lib/review/grade.test.ts`

**Interfaces:**
- Consumes: `CardState`, `Grade` из `./scheduler`.
- Produces:
  - `interface QueueCard { lessonSlug: string; cardId: string }`
  - `interface QueueLimits { newPerDay: number; sessionCap: number }`
  - `const DEFAULT_LIMITS: QueueLimits` (`{ newPerDay: 10, sessionCap: 40 }`)
  - `function buildQueue(cards: QueueCard[], states: Record<string, CardState>, today: string, limits?: QueueLimits): QueueCard[]`
  - `function stateKey(card: QueueCard): string` — `"<lessonSlug>/<cardId>"`
  - `function gradeAuto(correct: boolean): Grade`
  - `type SelfGrade = "again" | "hard" | "easy"`; `function gradeSelf(choice: SelfGrade): Grade`

- [ ] **Step 1: Написать падающие тесты очереди**

Создать `src/lib/review/queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildQueue, stateKey, type QueueCard } from "./queue";
import { newCardState, type CardState } from "./scheduler";

const TODAY = "2026-08-26";

function card(n: number, lesson = "01-alpha"): QueueCard {
  return { lessonSlug: lesson, cardId: `s-${n}` };
}

function due(dueOn: string): CardState {
  return { ...newCardState(dueOn), intervalDays: 3, reps: 2, dueOn };
}

describe("stateKey", () => {
  it("склеивает урок и карточку", () => {
    expect(stateKey(card(1))).toBe("01-alpha/s-1");
  });

  it("не путает одинаковые id карточек в разных уроках", () => {
    expect(stateKey(card(1, "01-alpha"))).not.toBe(stateKey(card(1, "02-beta")));
  });
});

describe("buildQueue — порядок", () => {
  it("просроченные идут первыми, дольше всех ждущие впереди", () => {
    const cards = [card(1), card(2), card(3)];
    const states = {
      "01-alpha/s-1": due("2026-08-25"),
      "01-alpha/s-2": due("2026-08-20"),
      "01-alpha/s-3": due(TODAY),
    };
    const queue = buildQueue(cards, states, TODAY);
    expect(queue.map((item) => item.cardId)).toEqual(["s-2", "s-1", "s-3"]);
  });

  it("не берёт карточки, срок которых ещё не наступил", () => {
    const states = { "01-alpha/s-1": due("2026-09-10") };
    expect(buildQueue([card(1)], states, TODAY)).toEqual([]);
  });
});

describe("buildQueue — лимиты", () => {
  it("берёт не больше newPerDay новых карточек", () => {
    const cards = Array.from({ length: 30 }, (_, i) => card(i));
    const queue = buildQueue(cards, {}, TODAY);
    expect(queue).toHaveLength(10);
  });

  it("не превышает потолок подхода при обилии просроченных", () => {
    const cards = Array.from({ length: 100 }, (_, i) => card(i));
    const states = Object.fromEntries(cards.map((item) => [stateKey(item), due("2026-08-01")]));
    expect(buildQueue(cards, states, TODAY)).toHaveLength(40);
  });

  it("уважает переданные лимиты вместо умолчаний", () => {
    const cards = Array.from({ length: 30 }, (_, i) => card(i));
    const queue = buildQueue(cards, {}, TODAY, { newPerDay: 3, sessionCap: 5 });
    expect(queue).toHaveLength(3);
  });
});

describe("buildQueue — подмешивание новых", () => {
  it("не сваливает новые карточки в конец подхода", () => {
    const known = Array.from({ length: 10 }, (_, i) => card(i));
    const fresh = Array.from({ length: 5 }, (_, i) => card(100 + i));
    const states = Object.fromEntries(known.map((item) => [stateKey(item), due(TODAY)]));
    const queue = buildQueue([...known, ...fresh], states, TODAY);

    const positions = queue
      .map((item, index) => ({ index, isNew: !states[stateKey(item)] }))
      .filter((item) => item.isNew)
      .map((item) => item.index);
    // Все новые в хвосте означали бы позицию каждой не меньше 10.
    expect(Math.min(...positions)).toBeLessThan(10);
  });
});

describe("buildQueue — пусто", () => {
  it("пустой каталог даёт пустую очередь", () => {
    expect(buildQueue([], {}, TODAY)).toEqual([]);
  });
});
```

- [ ] **Step 2: Написать падающие тесты оценок**

Создать `src/lib/review/grade.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { gradeAuto, gradeSelf } from "./grade";

describe("gradeAuto", () => {
  it("верный ответ — это good", () => {
    expect(gradeAuto(true)).toBe("good");
  });

  it("неверный ответ — это again", () => {
    expect(gradeAuto(false)).toBe("again");
  });
});

describe("gradeSelf", () => {
  it("переносит три кнопки один в один", () => {
    expect(gradeSelf("again")).toBe("again");
    expect(gradeSelf("hard")).toBe("hard");
    expect(gradeSelf("easy")).toBe("easy");
  });
});
```

- [ ] **Step 3: Прогнать оба и убедиться, что падают**

Run: `npx vitest run src/lib/review/queue.test.ts src/lib/review/grade.test.ts`
Expected: FAIL, модули не найдены.

- [ ] **Step 4: Написать `src/lib/review/grade.ts`**

```ts
import type { Grade } from "./scheduler";

/**
 * Автопроверяемая карточка: верно — «хорошо», неверно — «снова».
 *
 * Промежуточных оценок здесь нет намеренно: машина знает только факт
 * попадания, а «с трудом» — это про ощущение человека, которого она не видит.
 */
export function gradeAuto(correct: boolean): Grade {
  return correct ? "good" : "again";
}

/** Кнопки самооценки у карточки «объясни своими словами». */
export type SelfGrade = "again" | "hard" | "easy";

/**
 * `good` человеку недоступна намеренно: три кнопки различимы на глаз,
 * четыре превращаются в гадание.
 */
export function gradeSelf(choice: SelfGrade): Grade {
  return choice;
}
```

- [ ] **Step 5: Написать `src/lib/review/queue.ts`**

```ts
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
```

- [ ] **Step 6: Прогнать тесты**

Run: `npx vitest run src/lib/review/queue.test.ts src/lib/review/grade.test.ts`
Expected: PASS, 11 тестов.

- [ ] **Step 7: Коммит**

```bash
git add src/lib/review/queue.ts src/lib/review/queue.test.ts src/lib/review/grade.ts src/lib/review/grade.test.ts
git commit -m "feat(review): build the daily queue and map answers to grades"
```

---

### Task 3: Состояние графика в localStorage

**Files:**
- Modify: `src/lib/site/storage-keys.ts`
- Create: `src/lib/review/storage.ts`
- Test: `src/lib/review/storage.test.ts`, `src/lib/site/storage-keys.test.ts` (дополнить)

**Interfaces:**
- Consumes: `CardState` из `./scheduler`; `stateKey` из `./queue`.
- Produces:
  - `REVIEW_KEY_PREFIX = "course-review:"` из `storage-keys.ts`
  - `interface ReviewStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }`
  - `function readLessonStates(storage: ReviewStorage, slug: string): Record<string, StoredState>`
  - `function writeCardState(storage: ReviewStorage, slug: string, cardId: string, state: StoredState): void`
  - `interface StoredState extends CardState { fingerprint: string; updatedAt: string }`

- [ ] **Step 1: Добавить ключ**

В `src/lib/site/storage-keys.ts` дописать после `SYNCED_KEY_PREFIX`:

```ts
/**
 * График повторений урока: `course-review:<lesson-slug>`, значение — объект
 * `{ "<card-id>": { intervalDays, ease, reps, lapses, dueOn, fingerprint, updatedAt } }`.
 *
 * Отпечаток лежит рядом с состоянием, потому что переписанная по существу
 * карточка не должна унаследовать чужой график: человек получил бы интервал в
 * три месяца на вопрос, которого никогда не видел.
 */
export const REVIEW_KEY_PREFIX = "course-review:";
```

В `src/lib/site/storage-keys.test.ts` дописать проверку строки в существующий
набор — файл закрепляет значения ключей, потому что разъехавшиеся означают
потерянный прогресс у людей, которые уже читают сайт:

```ts
it("ключ графика повторений закреплён", () => {
  expect(REVIEW_KEY_PREFIX).toBe("course-review:");
});
```

- [ ] **Step 2: Написать падающие тесты хранилища**

Создать `src/lib/review/storage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readLessonStates, writeCardState, type StoredState } from "./storage";

function fakeStorage(seed: Record<string, string> = {}) {
  const data = { ...seed };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

function stored(over: Partial<StoredState> = {}): StoredState {
  return {
    intervalDays: 6,
    ease: 2.5,
    reps: 2,
    lapses: 0,
    dueOn: "2026-09-02",
    fingerprint: "abcd1234",
    updatedAt: "2026-08-26T10:00:00.000Z",
    ...over,
  };
}

describe("readLessonStates", () => {
  it("читает записанное", () => {
    const storage = fakeStorage();
    writeCardState(storage, "01-alpha", "s-1", stored());
    expect(readLessonStates(storage, "01-alpha")["s-1"]).toEqual(stored());
  });

  it("на отсутствующем уроке возвращает пустой объект", () => {
    expect(readLessonStates(fakeStorage(), "01-alpha")).toEqual({});
  });

  it("на битом JSON возвращает пустой объект, а не бросает", () => {
    const storage = fakeStorage({ "course-review:01-alpha": "{не json" });
    expect(readLessonStates(storage, "01-alpha")).toEqual({});
  });

  it("переживает хранилище, которое бросает на чтении", () => {
    const throwing = {
      getItem: () => {
        throw new Error("приватное окно Safari");
      },
      setItem: () => {},
    };
    expect(readLessonStates(throwing, "01-alpha")).toEqual({});
  });
});

describe("writeCardState", () => {
  it("не затирает состояние соседних карточек урока", () => {
    const storage = fakeStorage();
    writeCardState(storage, "01-alpha", "s-1", stored());
    writeCardState(storage, "01-alpha", "s-2", stored({ intervalDays: 1 }));

    const states = readLessonStates(storage, "01-alpha");
    expect(Object.keys(states).sort()).toEqual(["s-1", "s-2"]);
    expect(states["s-1"].intervalDays).toBe(6);
  });

  it("молча переживает отказ записи", () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeCardState(throwing, "01-alpha", "s-1", stored())).not.toThrow();
  });
});
```

- [ ] **Step 3: Прогнать и убедиться, что падает**

Run: `npx vitest run src/lib/review/storage.test.ts`
Expected: FAIL, `Failed to resolve import "./storage"`.

- [ ] **Step 4: Написать `src/lib/review/storage.ts`**

```ts
import { REVIEW_KEY_PREFIX } from "../site/storage-keys";
import type { CardState } from "./scheduler";

/**
 * Состояние карточки на диске.
 *
 * К полям планировщика добавлены два: отпечаток карточки, по которому видно,
 * что вопрос переписали, и время правки — оно нужно слиянию с облаком, чтобы
 * знать, чья запись свежее.
 */
export interface StoredState extends CardState {
  fingerprint: string;
  updatedAt: string;
}

/** То, что нужно от localStorage. Интерфейс ради тестов без браузера. */
export interface ReviewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Всякое обращение обёрнуто в try целиком.
 *
 * В приватном окне Safari запись бросает, и без обёртки на этом падал бы весь
 * скрипт страницы, включая навигацию. Пустой объект означает «графика нет»,
 * и страница просто предложит новые карточки.
 */
export function readLessonStates(
  storage: ReviewStorage,
  slug: string,
): Record<string, StoredState> {
  try {
    const raw = storage.getItem(REVIEW_KEY_PREFIX + slug);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, StoredState>) : {};
  } catch {
    return {};
  }
}

export function writeCardState(
  storage: ReviewStorage,
  slug: string,
  cardId: string,
  state: StoredState,
): void {
  try {
    const states = readLessonStates(storage, slug);
    states[cardId] = state;
    storage.setItem(REVIEW_KEY_PREFIX + slug, JSON.stringify(states));
  } catch {
    // Отказ записи означает подход, который не сохранится. Ронять страницу
    // из-за этого нельзя: читать урок человек может и без графика.
  }
}
```

- [ ] **Step 5: Прогнать тесты**

Run: `npx vitest run src/lib/review/storage.test.ts src/lib/site/storage-keys.test.ts`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add src/lib/review/storage.ts src/lib/review/storage.test.ts src/lib/site/storage-keys.ts src/lib/site/storage-keys.test.ts
git commit -m "feat(review): keep the schedule in localStorage for guests"
```

---

### Task 4: Таблица в Supabase и правило слияния

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `src/lib/sync/merge.ts`
- Test: `src/lib/sync/merge.test.ts` (дополнить)

**Interfaces:**
- Consumes: `StoredState` из `../review/storage`.
- Produces:
  - `interface CardRow { lessonSlug: string; cardId: string; fingerprint: string; state: StoredState }`
  - `function mergeCard(local: CardRow | null, cloud: CardRow | null, fileFingerprint: string): CardRow | null`
  - `function mergeCards(local: CardRow[], cloud: CardRow[], fingerprints: Record<string, string>): CardRow[]`

- [ ] **Step 1: Добавить таблицу в `supabase/schema.sql`**

Дописать после блока `run_results`, до `alter table ... enable row level security`:

```sql
-- График повторений. Только текущее состояние карточки, не история ответов:
-- истории в интерфейсе нет, а бесплатная база не то место, где копят журнал.
-- Цена решения названа прямо: без истории переход на FSRS позже потребует
-- начинать сбор данных с нуля.
--
-- Отпечаток лежит рядом с состоянием: переписанная по существу карточка не
-- должна унаследовать чужой график.
create table if not exists review_cards (
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  lesson_slug   text not null check (length(lesson_slug) < 200),
  card_id       text not null check (length(card_id) < 200),
  fingerprint   text not null check (length(fingerprint) < 100),
  due_on        date not null,
  interval_days integer not null,
  ease          real not null,
  reps          integer not null,
  lapses        integer not null,
  updated_at    timestamptz not null default now(),
  primary key (user_id, lesson_slug, card_id)
);
```

И в трёх местах ниже — там, где перечислены существующие три таблицы, — дописать
четвёртую строку по образцу соседних: `alter table ... enable row level
security`, блок `drop policy` / `create policy "own rows"`, `grant select,
insert, update, delete ... to authenticated`, `revoke all ... from anon`.

- [ ] **Step 2: Написать падающие тесты слияния**

Дописать в `src/lib/sync/merge.test.ts`:

```ts
import { mergeCard, mergeCards, type CardRow } from "./merge";

function row(over: Partial<CardRow> = {}): CardRow {
  return {
    lessonSlug: "01-alpha",
    cardId: "s-1",
    fingerprint: "abcd1234",
    state: {
      intervalDays: 6,
      ease: 2.5,
      reps: 2,
      lapses: 0,
      dueOn: "2026-09-02",
      fingerprint: "abcd1234",
      updatedAt: "2026-08-26T10:00:00.000Z",
    },
    ...over,
  };
}

function at(time: string, over: Partial<CardRow["state"]> = {}): CardRow {
  return row({ state: { ...row().state, updatedAt: time, ...over } });
}

describe("mergeCard", () => {
  it("одна сторона пуста — берётся другая", () => {
    expect(mergeCard(row(), null, "abcd1234")).toEqual(row());
    expect(mergeCard(null, row(), "abcd1234")).toEqual(row());
  });

  it("побеждает свежая запись", () => {
    const local = at("2026-08-26T12:00:00.000Z", { intervalDays: 30 });
    const cloud = at("2026-08-26T10:00:00.000Z", { intervalDays: 3 });
    expect(mergeCard(local, cloud, "abcd1234")?.state.intervalDays).toBe(30);
  });

  it("при равенстве времён побеждает меньший интервал", () => {
    const local = at("2026-08-26T10:00:00.000Z", { intervalDays: 30 });
    const cloud = at("2026-08-26T10:00:00.000Z", { intervalDays: 3 });
    expect(mergeCard(local, cloud, "abcd1234")?.state.intervalDays).toBe(3);
  });

  it("отбрасывает состояние с чужим отпечатком", () => {
    expect(mergeCard(row(), null, "ffff0000")).toBeNull();
  });

  it("отбрасывает обе стороны, если карточку переписали", () => {
    expect(mergeCard(row(), row(), "ffff0000")).toBeNull();
  });
});

describe("mergeCards", () => {
  it("сводит списки по паре урок плюс карточка", () => {
    const local = [row(), row({ cardId: "s-2" })];
    const cloud = [row({ cardId: "s-3" })];
    const merged = mergeCards(local, cloud, {
      "01-alpha/s-1": "abcd1234",
      "01-alpha/s-2": "abcd1234",
      "01-alpha/s-3": "abcd1234",
    });
    expect(merged.map((item) => item.cardId).sort()).toEqual(["s-1", "s-2", "s-3"]);
  });

  it("выбрасывает карточку, которой больше нет в файлах", () => {
    const merged = mergeCards([row({ cardId: "s-9" })], [], {});
    expect(merged).toEqual([]);
  });
});
```

- [ ] **Step 3: Прогнать и убедиться, что падает**

Run: `npx vitest run src/lib/sync/merge.test.ts`
Expected: FAIL, `mergeCard is not a function`.

- [ ] **Step 4: Дописать правила в `src/lib/sync/merge.ts`**

```ts
import type { StoredState } from "../review/storage";

export interface CardRow {
  lessonSlug: string;
  cardId: string;
  fingerprint: string;
  state: StoredState;
}

/**
 * Слияние графика одной карточки.
 *
 * Правило несимметрично намеренно, потому что несимметричны цены ошибки:
 * ошибочно длинный интервал стоит потерянного знания, ошибочно короткий — одного
 * лишнего повторения. Поэтому при равенстве времён побеждает меньший интервал.
 *
 * Отпечаток из файла карточки старше обеих сторон: если вопрос переписали,
 * продолжать на нём накопленный график нельзя, и состояние отбрасывается целиком.
 */
export function mergeCard(
  local: CardRow | null,
  cloud: CardRow | null,
  fileFingerprint: string,
): CardRow | null {
  const fresh = (row: CardRow | null) => (row && row.fingerprint === fileFingerprint ? row : null);
  const l = fresh(local);
  const c = fresh(cloud);

  if (!l) return c;
  if (!c) return l;
  if (l.state.updatedAt !== c.state.updatedAt) {
    return l.state.updatedAt > c.state.updatedAt ? l : c;
  }
  return l.state.intervalDays <= c.state.intervalDays ? l : c;
}

export function mergeCards(
  local: CardRow[],
  cloud: CardRow[],
  fingerprints: Record<string, string>,
): CardRow[] {
  const key = (row: CardRow) => `${row.lessonSlug}/${row.cardId}`;
  const byKey = new Map<string, { local?: CardRow; cloud?: CardRow }>();

  for (const row of local) byKey.set(key(row), { ...byKey.get(key(row)), local: row });
  for (const row of cloud) byKey.set(key(row), { ...byKey.get(key(row)), cloud: row });

  const merged: CardRow[] = [];
  for (const [id, pair] of byKey) {
    // Карточки, которой больше нет в файлах, нет и в отпечатках: её график
    // не переносится никуда — вопрос удалён из урока.
    const fingerprint = fingerprints[id];
    if (!fingerprint) continue;
    const row = mergeCard(pair.local ?? null, pair.cloud ?? null, fingerprint);
    if (row) merged.push(row);
  }
  return merged;
}
```

- [ ] **Step 5: Прогнать тесты**

Run: `npx vitest run src/lib/sync/merge.test.ts`
Expected: PASS.

- [ ] **Step 6: Накатить схему руками**

Открыть SQL Editor в консоли Supabase и выполнить содержимое `supabase/schema.sql`.
Файл идемпотентен (`create table if not exists`, `drop policy if exists`), поэтому
безопасно выполняется целиком поверх существующей базы. Проверить, что таблица
`review_cards` появилась и у неё включён RLS.

Если доступа к консоли нет — сказать об этом в отчёте и не выдумывать, что
схема накачена.

- [ ] **Step 7: Коммит**

```bash
git add supabase/schema.sql src/lib/sync/merge.ts src/lib/sync/merge.test.ts
git commit -m "feat(review): add the review_cards table and its merge rule"
```

---

### Task 5: Выгрузка карточек в статику

**Files:**
- Modify: `scripts/build-site.mts`
- Create: `src/lib/site/cards-payload.ts`
- Test: `src/lib/site/cards-payload.test.ts`

**Interfaces:**
- Consumes: `Card` из `../cards/card`; `lessonSlugs` из `../content/lessons`.
- Produces:
  - `interface SiteCard` — карточка без поля `concept`
  - `interface CardsManifestEntry { slug: string; title: string; count: number }`
  - `function toSiteCards(cards: Card[]): SiteCard[]`
  - `function buildManifest(entries: { slug: string; title: string; cards: number }[]): CardsManifestEntry[]`
- Файлы на выходе сборки: `cards/<slug>.json` — массив `SiteCard`; `cards/index.json` — массив `CardsManifestEntry`.

- [ ] **Step 1: Написать падающие тесты**

Создать `src/lib/site/cards-payload.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildManifest, toSiteCards } from "./cards-payload";
import type { Card } from "../cards/card";

const CARD: Card = {
  kind: "numeric",
  concept: "стартовый loss равен логарифму размера словаря",
  question: "В словаре 1024 токена. Чему примерно равен loss?",
  explanation: "ln(1024) ≈ 6.93.",
  answer: 6.93,
  tolerance: 0.05,
  id: "046-quiz-1",
  fingerprint: "abcd1234",
};

describe("toSiteCards", () => {
  it("выбрасывает concept: он нужен аудиту, а не читателю", () => {
    const [card] = toSiteCards([CARD]);
    expect("concept" in card).toBe(false);
  });

  it("сохраняет id и отпечаток — по ним живёт график", () => {
    const [card] = toSiteCards([CARD]);
    expect(card.id).toBe("046-quiz-1");
    expect(card.fingerprint).toBe("abcd1234");
  });

  it("сохраняет поля вида карточки", () => {
    const [card] = toSiteCards([CARD]);
    expect(card).toMatchObject({ kind: "numeric", answer: 6.93, tolerance: 0.05 });
  });
});

describe("buildManifest", () => {
  it("оставляет только уроки, у которых есть карточки", () => {
    const manifest = buildManifest([
      { slug: "01-alpha", title: "Альфа", cards: 3 },
      { slug: "02-beta", title: "Бета", cards: 0 },
    ]);
    expect(manifest).toEqual([{ slug: "01-alpha", title: "Альфа", count: 3 }]);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run src/lib/site/cards-payload.test.ts`
Expected: FAIL, модуль не найден.

- [ ] **Step 3: Написать `src/lib/site/cards-payload.ts`**

```ts
import type { Card } from "../cards/card";

/**
 * Карточка в том виде, в каком она едет в браузер.
 *
 * Отличие от файла ровно одно: выброшен `concept`. Он существует для контроля
 * разнообразия при генерации и для аудита, читателю не показывается никогда, а
 * на тридцати тысячах карточек это заметный вес на проводе.
 */
export type SiteCard = Omit<Card, "concept">;

export interface CardsManifestEntry {
  slug: string;
  title: string;
  count: number;
}

export function toSiteCards(cards: Card[]): SiteCard[] {
  return cards.map(({ concept: _concept, ...rest }) => rest);
}

/**
 * Манифест — список уроков, у которых карточки есть.
 *
 * Без него страница не знает, куда ходить, и либо тянет все 474 файла, либо
 * пробует их по одному и собирает сотни 404. С манифестом она делает один
 * запрос и дальше берёт только нужные уроки.
 */
export function buildManifest(
  entries: { slug: string; title: string; cards: number }[],
): CardsManifestEntry[] {
  return entries
    .filter((entry) => entry.cards > 0)
    .map((entry) => ({ slug: entry.slug, title: entry.title, count: entry.cards }));
}
```

- [ ] **Step 4: Дописать выгрузку в `scripts/build-site.mts`**

Внутри цикла по урокам, там где уже читаются шаги, собрать карточки урока из
`content/lessons/<slug>/cards/*.yml` через `readCards(contentDir, slug, stepId)`
для каждого id плана, склеить в один массив и, если он непустой, записать:

```ts
const lessonCards: Card[] = [];
for (const meta of plan.steps) {
  const cards = readCards(contentDir, slug, meta.id);
  if (cards) lessonCards.push(...cards);
}
if (lessonCards.length) {
  write(path.join("cards", `${slug}.json`), JSON.stringify(toSiteCards(lessonCards)));
}
manifestEntries.push({ slug, title: plan.title, cards: lessonCards.length });
```

После цикла — манифест:

```ts
write(path.join("cards", "index.json"), JSON.stringify(buildManifest(manifestEntries)));
```

- [ ] **Step 5: Собрать сайт и проверить выгрузку**

Run: `npm run site:pages`
Expected: сборка проходит. Затем:

```bash
ls out/cards | head
node -p "require('./out/cards/index.json').length"
node -p "require('./out/cards/01-math-foundations__07-bayes-theorem.json').length"
```

Ожидается: три файла урока плюс `index.json`; в манифесте три записи; у Байеса
132 карточки. Если числа другие — не подгонять, а сказать в отчёте.

- [ ] **Step 6: Коммит**

```bash
git add src/lib/site/cards-payload.ts src/lib/site/cards-payload.test.ts scripts/build-site.mts
git commit -m "feat(review): ship cards to the site as one file per lesson"
```

---

### Task 6: Отрисовка карточек пяти видов

**Files:**
- Create: `src/site-review/renderers/choice.ts`, `numeric.ts`, `cloze.ts`, `order.ts`, `open.ts`, `index.ts`
- Create: `src/site-review/renderers/types.ts`
- Test: `src/site-review/renderers/renderers.test.ts`

**Interfaces:**
- Consumes: `SiteCard` из `../../lib/site/cards-payload`; `Grade` из `../../lib/review/scheduler`; `gradeAuto`, `gradeSelf` из `../../lib/review/grade`.
- Produces:
  - `interface AnswerResult { grade: Grade; correct: boolean | null }` — `correct` равен `null` у самооценки
  - `interface CardRenderer { mount(host: HTMLElement, card: SiteCard, onAnswer: (result: AnswerResult) => void): void }`
  - `const RENDERERS: Record<SiteCard["kind"], CardRenderer>`

- [ ] **Step 1: Написать падающие тесты**

Создать `src/site-review/renderers/renderers.test.ts`.

**Важно про окружение.** `vitest.config.mts` задаёт `environment: "node"` —
глобального `document` в тестах нет. DOM создаётся вручную, как это уже сделано
в `src/site-search/modal.test.ts`: там на каждый тест конструируется
`new Window()` из `happy-dom` и берётся его `document`. Скопируй эту схему,
а не пиши бареное `document` — иначе тесты падают на `document is not defined`.
Отрисовщик получает элемент этого окна, поэтому в самом коде отрисовщиков
обращаться к глобальному `document` тоже нельзя: узлы создаются через
`host.ownerDocument`.

```ts
import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RENDERERS } from "./index";
import type { SiteCard } from "../../lib/site/cards-payload";

let window: Window;

beforeEach(() => {
  window = new Window();
});

function host(): HTMLElement {
  const element = window.document.createElement("div");
  window.document.body.appendChild(element);
  return element as unknown as HTMLElement;
}

const CHOICE: SiteCard = {
  kind: "choice",
  question: "Что делает каузальная маска?",
  explanation: "Обнуляет вес позиций правее текущей.",
  options: ["Запрещает смотреть вправо", "Ускоряет softmax", "Экономит память"],
  correct: 0,
  id: "c-1",
  fingerprint: "abcd1234",
};

describe("choice", () => {
  it("показывает все варианты", () => {
    const element = host();
    RENDERERS.choice.mount(element, CHOICE, () => {});
    expect(element.querySelectorAll("button[data-option]")).toHaveLength(3);
  });

  it("верный выбор даёт good", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.choice.mount(element, CHOICE, onAnswer);
    element.querySelectorAll<HTMLButtonElement>("button[data-option]")[0].click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "good", correct: true });
  });

  it("неверный выбор даёт again", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.choice.mount(element, CHOICE, onAnswer);
    element.querySelectorAll<HTMLButtonElement>("button[data-option]")[1].click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "again", correct: false });
  });
});

describe("numeric", () => {
  const card: SiteCard = {
    kind: "numeric",
    question: "Чему равен loss?",
    explanation: "ln(1024) ≈ 6.93.",
    answer: 6.93,
    tolerance: 0.05,
    id: "n-1",
    fingerprint: "abcd1234",
  };

  it("принимает ответ внутри допуска", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.numeric.mount(element, card, onAnswer);
    element.querySelector<HTMLInputElement>("input")!.value = "6.95";
    element.querySelector<HTMLButtonElement>("button[data-submit]")!.click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "good", correct: true });
  });

  it("отвергает ответ вне допуска", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.numeric.mount(element, card, onAnswer);
    element.querySelector<HTMLInputElement>("input")!.value = "7.5";
    element.querySelector<HTMLButtonElement>("button[data-submit]")!.click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "again", correct: false });
  });

  it("принимает запятую как десятичный разделитель", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.numeric.mount(element, card, onAnswer);
    element.querySelector<HTMLInputElement>("input")!.value = "6,93";
    element.querySelector<HTMLButtonElement>("button[data-submit]")!.click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "good", correct: true });
  });
});

describe("cloze", () => {
  const card: SiteCard = {
    kind: "cloze",
    question: "Допиши строку",
    explanation: "Сумма по последней оси.",
    template: "probs = exp / exp.sum(___)",
    answer: "axis=-1",
    accept: ["axis = -1"],
    id: "z-1",
    fingerprint: "abcd1234",
  };

  it("принимает точный ответ", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.cloze.mount(element, card, onAnswer);
    element.querySelector<HTMLInputElement>("input")!.value = "axis=-1";
    element.querySelector<HTMLButtonElement>("button[data-submit]")!.click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "good", correct: true });
  });

  it("принимает написание из accept и не придирается к регистру и пробелам", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.cloze.mount(element, card, onAnswer);
    element.querySelector<HTMLInputElement>("input")!.value = "  AXIS = -1 ";
    element.querySelector<HTMLButtonElement>("button[data-submit]")!.click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "good", correct: true });
  });
});

describe("order", () => {
  const card: SiteCard = {
    kind: "order",
    question: "Расставь шаги",
    explanation: "Справа налево.",
    items: ["Первый", "Второй", "Третий"],
    id: "o-1",
    fingerprint: "abcd1234",
  };

  it("показывает элементы перемешанными, но все", () => {
    const element = host();
    RENDERERS.order.mount(element, card, () => {});
    const labels = [...element.querySelectorAll("[data-item]")].map((node) => node.textContent);
    expect(labels.sort()).toEqual(["Второй", "Первый", "Третий"]);
  });

  it("правильный порядок даёт good", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.order.mount(element, card, onAnswer);
    for (const label of card.items) {
      [...element.querySelectorAll<HTMLButtonElement>("[data-item]")]
        .find((node) => node.textContent === label)!
        .click();
    }
    expect(onAnswer).toHaveBeenCalledWith({ grade: "good", correct: true });
  });
});

describe("open", () => {
  const card: SiteCard = {
    kind: "open",
    question: "Объясни своими словами",
    explanation: "Разбор.",
    reference: "Эталонный ответ целиком.",
    id: "p-1",
    fingerprint: "abcd1234",
  };

  it("показывает эталон только после запроса", () => {
    const element = host();
    RENDERERS.open.mount(element, card, () => {});
    expect(element.textContent).not.toContain("Эталонный ответ целиком.");
    element.querySelector<HTMLButtonElement>("button[data-reveal]")!.click();
    expect(element.textContent).toContain("Эталонный ответ целиком.");
  });

  it("даёт ровно три кнопки самооценки", () => {
    const element = host();
    RENDERERS.open.mount(element, card, () => {});
    element.querySelector<HTMLButtonElement>("button[data-reveal]")!.click();
    expect(element.querySelectorAll("button[data-self]")).toHaveLength(3);
  });

  it("самооценка приходит без признака правильности", () => {
    const element = host();
    const onAnswer = vi.fn();
    RENDERERS.open.mount(element, card, onAnswer);
    element.querySelector<HTMLButtonElement>("button[data-reveal]")!.click();
    element.querySelector<HTMLButtonElement>('button[data-self="hard"]')!.click();
    expect(onAnswer).toHaveBeenCalledWith({ grade: "hard", correct: null });
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run src/site-review/renderers/renderers.test.ts`
Expected: FAIL, модуль не найден.

- [ ] **Step 3: Написать `types.ts`**

```ts
import type { Grade } from "../../lib/review/scheduler";
import type { SiteCard } from "../../lib/site/cards-payload";

export interface AnswerResult {
  grade: Grade;
  /** `null` у самооценки: там правильности как факта не существует. */
  correct: boolean | null;
}

/**
 * Отрисовщик одного вида карточки.
 *
 * Знает только карточку и колбэк. Ни про очередь, ни про планировщик, ни про
 * хранилище ему знать нечего — новый вид добавляется новым модулем и одной
 * строкой в таблице RENDERERS.
 */
export interface CardRenderer {
  mount(host: HTMLElement, card: SiteCard, onAnswer: (result: AnswerResult) => void): void;
}
```

- [ ] **Step 4: Написать пять отрисовщиков и таблицу**

Каждый — отдельный модуль, экспортирующий `const renderer: CardRenderer`. Общие
правила для всех пяти: текст вопроса вставляется через `textContent`, а не
`innerHTML` — вопросы приходят из файла в репозитории, но привычка вставлять
чужой текст разметкой однажды прострелит ногу; у каждой кнопки есть `type="button"`;
после ответа элементы ввода блокируются, чтобы второй клик не пересчитал оценку.

`choice.ts` — кнопка на вариант, `data-option` с индексом, при клике
`onAnswer({ grade: gradeAuto(index === card.correct), correct: index === card.correct })`.

`numeric.ts` — поле ввода и кнопка `data-submit`; ответ разбирается
`Number(value.replace(",", "."))`, сравнение `Math.abs(parsed - card.answer) <= card.tolerance`;
пустое или нечисловое значение считается неверным ответом, а не ошибкой.

`cloze.ts` — шаблон с подстановкой поля ввода вместо `___`, кнопка `data-submit`;
сравнение по нормализованной строке: `trim`, нижний регистр, схлопнутые пробелы;
принимаются `card.answer` и все `card.accept`.

`order.ts` — кнопки `data-item` в перемешанном порядке; клик добавляет элемент в
ответ и блокирует кнопку; когда выбраны все, сравнивается собранный порядок с
`card.items`. Перемешивание — Фишер—Йейтс; при совпадении перемешанного порядка
с исходным перемешать заново, иначе карточка иногда «решается» без чтения.

`open.ts` — вопрос, кнопка `data-reveal`; после нажатия показывается
`card.reference` и три кнопки `data-self` со значениями `again`, `hard`, `easy`;
`onAnswer({ grade: gradeSelf(value), correct: null })`.

`index.ts`:

```ts
import { choice } from "./choice";
import { cloze } from "./cloze";
import { numeric } from "./numeric";
import { open } from "./open";
import { order } from "./order";
import type { CardRenderer } from "./types";
import type { SiteCard } from "../../lib/site/cards-payload";

export type { AnswerResult, CardRenderer } from "./types";

export const RENDERERS: Record<SiteCard["kind"], CardRenderer> = {
  choice,
  numeric,
  cloze,
  order,
  open,
};
```

- [ ] **Step 5: Прогнать тесты**

Run: `npx vitest run src/site-review/renderers/renderers.test.ts`
Expected: PASS, 14 тестов.

- [ ] **Step 6: Коммит**

```bash
git add src/site-review/renderers
git commit -m "feat(review): render the five card kinds"
```

---

### Task 7: Страница подхода

**Files:**
- Create: `src/site-review/session.ts`, `src/site-review/cards-source.ts`, `src/site-review/index.ts`
- Test: `src/site-review/session.test.ts`
- Modify: `src/lib/site/render.tsx`, `scripts/build-site.mts`

**Interfaces:**
- Consumes: `RENDERERS`, `AnswerResult`; `buildQueue`, `stateKey`, `DEFAULT_LIMITS`; `schedule`, `newCardState`; `readLessonStates`, `writeCardState`.
- Produces:
  - `interface SessionDeps { cards: Record<string, SiteCard[]>; states: Record<string, StoredState>; today: string; onGraded(lessonSlug: string, card: SiteCard, state: StoredState): void }`
  - `function runSession(host: HTMLElement, deps: SessionDeps): void`
  - `renderReviewPage(options: RenderOptions): string` из `render.tsx`

- [ ] **Step 1: Написать падающие тесты подхода**

Создать `src/site-review/session.test.ts`. Тест ведёт полный цикл: очередь,
ответ, назначение срока, переход к следующей карточке.

Окружение то же, что в Task 6: `environment: "node"`, поэтому DOM строится
вручную через `new Window()` из `happy-dom`.

```ts
import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSession } from "./session";
import type { SiteCard } from "../lib/site/cards-payload";

const TODAY = "2026-08-26";

let window: Window;

beforeEach(() => {
  window = new Window();
});

function card(id: string): SiteCard {
  return {
    kind: "choice",
    question: `Вопрос ${id}`,
    explanation: "Разбор.",
    options: ["Верно", "Неверно", "Тоже неверно"],
    correct: 0,
    id,
    fingerprint: "abcd1234",
  };
}

function host(): HTMLElement {
  const element = window.document.createElement("div");
  window.document.body.appendChild(element);
  return element as unknown as HTMLElement;
}

describe("runSession", () => {
  it("показывает первую карточку очереди", () => {
    const element = host();
    runSession(element, {
      cards: { "01-alpha": [card("c-1")] },
      states: {},
      today: TODAY,
      onGraded: () => {},
    });
    expect(element.textContent).toContain("Вопрос c-1");
  });

  it("после ответа показывает разбор, а не следующую карточку сразу", () => {
    const element = host();
    runSession(element, {
      cards: { "01-alpha": [card("c-1"), card("c-2")] },
      states: {},
      today: TODAY,
      onGraded: () => {},
    });
    element.querySelectorAll<HTMLButtonElement>("button[data-option]")[0].click();
    expect(element.textContent).toContain("Разбор.");
    expect(element.textContent).toContain("Вопрос c-1");
  });

  it("кнопка «дальше» переводит к следующей карточке", () => {
    const element = host();
    runSession(element, {
      cards: { "01-alpha": [card("c-1"), card("c-2")] },
      states: {},
      today: TODAY,
      onGraded: () => {},
    });
    element.querySelectorAll<HTMLButtonElement>("button[data-option]")[0].click();
    element.querySelector<HTMLButtonElement>("button[data-next]")!.click();
    expect(element.textContent).toContain("Вопрос c-2");
  });

  it("сохраняет назначенный срок верного ответа", () => {
    const element = host();
    const onGraded = vi.fn();
    runSession(element, {
      cards: { "01-alpha": [card("c-1")] },
      states: {},
      today: TODAY,
      onGraded,
    });
    element.querySelectorAll<HTMLButtonElement>("button[data-option]")[0].click();

    expect(onGraded).toHaveBeenCalledTimes(1);
    const [slug, answered, state] = onGraded.mock.calls[0];
    expect(slug).toBe("01-alpha");
    expect(answered.id).toBe("c-1");
    expect(state.intervalDays).toBe(1);
    expect(state.dueOn).toBe("2026-08-27");
    expect(state.fingerprint).toBe("abcd1234");
  });

  it("неверный ответ возвращает карточку на завтра", () => {
    const element = host();
    const onGraded = vi.fn();
    runSession(element, {
      cards: { "01-alpha": [card("c-1")] },
      states: {},
      today: TODAY,
      onGraded,
    });
    element.querySelectorAll<HTMLButtonElement>("button[data-option]")[1].click();
    expect(onGraded.mock.calls[0][2]).toMatchObject({ intervalDays: 1, lapses: 1, reps: 0 });
  });

  it("на пустой очереди говорит, что на сегодня всё", () => {
    const element = host();
    runSession(element, { cards: {}, states: {}, today: TODAY, onGraded: () => {} });
    expect(element.textContent).toContain("На сегодня всё");
  });

  it("считает карточку с чужим отпечатком новой", () => {
    const element = host();
    const onGraded = vi.fn();
    runSession(element, {
      cards: { "01-alpha": [card("c-1")] },
      states: {
        "01-alpha/c-1": {
          intervalDays: 90,
          ease: 2.5,
          reps: 5,
          lapses: 0,
          dueOn: TODAY,
          fingerprint: "ffff0000",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      today: TODAY,
      onGraded,
    });
    element.querySelectorAll<HTMLButtonElement>("button[data-option]")[0].click();
    // Первый успех новой карточки — один день, а не продолжение девяноста.
    expect(onGraded.mock.calls[0][2].intervalDays).toBe(1);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run src/site-review/session.test.ts`
Expected: FAIL, модуль не найден.

- [ ] **Step 3: Написать `src/site-review/session.ts`**

Оркестрация: собрать плоский список `QueueCard` из `deps.cards`, отбросить
состояния с разошедшимся `fingerprint` (считая такую карточку новой), позвать
`buildQueue`, дальше вести подход по одной карточке — смонтировать отрисовщик
вида, по `onAnswer` посчитать `schedule(state ?? newCardState(today), grade, today)`,
позвать `deps.onGraded`, показать разбор и кнопку `data-next`, по ней перейти к
следующей. Пустая очередь — сообщение «На сегодня всё».

- [ ] **Step 4: Написать `src/site-review/cards-source.ts`**

Загрузка данных: `fetch` манифеста `cards/index.json`, затем файлов уроков,
у которых есть прогресс чтения (ключи `course-progress:` в `localStorage`) —
предлагать повторять непройденное бессмысленно. Отказ сети — сообщение, а не
пустая очередь: пустая очередь означала бы «всё повторено», и человек ушёл бы,
решив, что работы нет.

- [ ] **Step 5: Написать `src/site-review/index.ts`**

По образцу `src/site-search/index.ts`: прочитать `data-base` у `body`, прочитать
`?debug=1` и, если он есть, показать поле сдвига дня; собрать состояния из
`localStorage` через `readLessonStates`, позвать `runSession`, а в `onGraded`
записывать через `writeCardState`. Сдвиг дня перезапускает подход с датой
`addDays(today, n)`, ничего не записывая.

- [ ] **Step 6: Добавить страницу и сборку**

В `src/lib/site/render.tsx` — `renderReviewPage(options: RenderOptions)`: заголовок,
контейнер `[data-review]`, подключение `assets/review.js`, и — под `?debug=1` —
поле сдвига. В `scripts/build-site.mts` — функция `buildReview()` по образцу
`buildSearch()` (тот же вызов `build` с `entryPoints: src/site-review/index.ts`,
`outfile: out/assets/review.js`) и запись страницы:

```ts
write(path.join("review", "index.html"), renderReviewPage({ basePath, withAuth }));
```

- [ ] **Step 7: Проверить в браузере**

Run: `npm run site:pages && npx serve out` (или любой статический сервер), открыть
`/review/`, пройти несколько карточек, затем открыть `/review/?debug=1`, поставить
сдвиг в 3 дня и убедиться, что карточка, отвеченная уверенно, возвращается.

- [ ] **Step 8: Коммит**

```bash
git add src/site-review src/lib/site/render.tsx scripts/build-site.mts
git commit -m "feat(review): add the review page and its session loop"
```

---

### Task 8: Вход в режим с главной

**Files:**
- Modify: `src/lib/site/render.tsx`, `src/lib/site/client.ts`
- Test: `src/lib/site/render.test.ts` (дополнить)

- [ ] **Step 1: Написать падающий тест разметки**

Дописать в `src/lib/site/render.test.ts`:

Существующие тесты этого файла зовут `renderIndexPage([], { basePath: "/base" })`
— второй аргумент несёт только `basePath`. Держись той же формы:

```ts
it("на главной есть ссылка на повторения со счётчиком", () => {
  const html = renderIndexPage([], { basePath: "/base" });
  expect(html).toContain('href="/base/review/"');
  expect(html).toContain("data-review-due");
});
```

- [ ] **Step 2: Добавить ссылку в `renderIndexPage`**

В шапку главной, рядом с кнопкой поиска: ссылка на `/review/` с пустым
`<span data-review-due hidden></span>` внутри. Число проставляет клиентский
скрипт — на сервере его знать неоткуда.

- [ ] **Step 3: Считать число готовых карточек в `client.ts`**

В `CATALOG_SCRIPT` дописать: пройти ключи `localStorage` с префиксом
`course-review:`, посчитать состояния с `dueOn <= сегодня`, и если счёт больше
нуля — записать его в `[data-review-due]` и снять `hidden`. Всё в `try`, как и
остальная работа с хранилищем на этой странице.

- [ ] **Step 4: Прогнать тесты и собрать сайт**

Run: `npx vitest run src/lib/site/render.test.ts && npm run site:pages`
Expected: PASS, сборка проходит.

- [ ] **Step 5: Обновить README**

В разделе «Аккаунты на опубликованном сайте» дописать абзац про режим
повторений: что он есть, что работает без входа с состоянием в браузере, что при
входе график едет между устройствами. В «Ограничения текущего среза» убрать
строку про то, что интервальные повторения вне этого среза, — она станет ложной.

- [ ] **Step 6: Коммит**

```bash
git add src/lib/site/render.tsx src/lib/site/client.ts src/lib/site/render.test.ts README.md
git commit -m "feat(review): link the review mode from the catalogue"
```

---

## Self-Review

**Покрытие спеки.** Три чистых модуля — Task 1 и 2. Числа SM-2 и пол лёгкости —
Task 1. Лимиты и подмешивание новых — Task 2. Ключ `localStorage` и отказы
хранилища — Task 3. Таблица с RLS и правило слияния, включая несимметричность при
равенстве времён и отбрасывание по отпечатку — Task 4. Выгрузка по файлу на урок
и манифест — Task 5. Отрисовщики пяти видов и таблица `kind → renderer` — Task 6.
Страница, подход, загрузка только пройденных уроков, отказ сети — Task 7.
Просмотр будущего дня — Task 7, шаги 5 и 7. Ссылка со счётчиком — Task 8.

**Чего в спеке не было и что добавлено сознательно.** Манифест `cards/index.json`:
без него страница не знает, в каких уроках есть карточки, и либо тянет всё, либо
собирает сотни 404. Тип `SiteCard` без поля `concept`: оно нужно аудиту, а не
читателю, и на тридцати тысячах карточек это вес на проводе.

**Что осталось за рамками намеренно.** Ветка вошедшего пользователя — чтение и
запись графика в Supabase — в этом плане не реализуется: правило слияния и
таблица готовы (Task 4), но подключение к `src/site-auth/auth.ts` требует живого
проекта Supabase и отдельного круга проверки. Гостевой путь работает целиком, и
это ровно тот срез, на котором проверяется формат карточки. Облачную ветку стоит
делать следующим планом, когда режим обкатан.
