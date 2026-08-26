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
