import { describe, expect, it } from "vitest";
import { groupLessons, type CatalogLesson } from "./catalog";

function lesson(slug: string, number: number): CatalogLesson {
  return { slug, title: "Урок", number, writtenCount: 10, plannedCount: 10 };
}

describe("groupLessons", () => {
  it("groups lessons by phase and orders both levels by number", () => {
    const phases = groupLessons([
      lesson("02-ml-fundamentals__02-linear-regression", 2),
      lesson("01-math-foundations__04-calculus-for-ml", 4),
      lesson("01-math-foundations__01-linear-algebra-intuition", 1),
    ]);

    expect(phases.map((phase) => phase.number)).toEqual([1, 2]);
    expect(phases[0].title).toBe("Math Foundations");
    expect(phases[0].lessons.map((item) => item.number)).toEqual([1, 4]);
  });

  it("drops a slug that does not name a phase and a lesson", () => {
    // Каталог строится по содержимому content/lessons, куда может попасть
    // что угодно: чужая папка не должна ронять главную страницу.
    expect(groupLessons([lesson("scratch", 1)])).toEqual([]);
  });
});
