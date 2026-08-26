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
