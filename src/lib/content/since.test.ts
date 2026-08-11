import { describe, expect, it } from "vitest";
import { since } from "./since";

const NOW = new Date("2026-08-11T12:00:00.000Z");

function ago(ms: number): string {
  return since(new Date(NOW.getTime() - ms).toISOString(), NOW);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("since", () => {
  it("свежее часа — «только что»", () => {
    expect(ago(0)).toBe("только что");
    expect(ago(59 * MINUTE)).toBe("только что");
  });

  it("часы считаются до суток", () => {
    expect(ago(HOUR)).toBe("1 час назад");
    expect(ago(2 * HOUR)).toBe("2 часа назад");
    expect(ago(5 * HOUR)).toBe("5 часов назад");
    expect(ago(23 * HOUR)).toBe("23 часа назад");
  });

  it("сутки — «вчера»", () => {
    expect(ago(DAY)).toBe("вчера");
    expect(ago(DAY + 5 * HOUR)).toBe("вчера");
  });

  it("склонение дней не врёт на 2, 5, 11 и 21", () => {
    expect(ago(2 * DAY)).toBe("2 дня назад");
    expect(ago(5 * DAY)).toBe("5 дней назад");
    expect(ago(11 * DAY)).toBe("11 дней назад");
    expect(ago(21 * DAY)).toBe("21 день назад");
    expect(ago(112 * DAY)).toBe("112 дней назад");
  });

  // Часы на машине переводят, и будущая дата не повод показать «-1 день назад».
  it("дата из будущего читается как «только что»", () => {
    expect(since(new Date(NOW.getTime() + HOUR).toISOString(), NOW)).toBe("только что");
  });

  it("мусор вместо даты не ломает строку", () => {
    expect(since("не дата", NOW)).toBe("");
  });
});
