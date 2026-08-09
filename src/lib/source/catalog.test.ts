import { describe, expect, it } from "vitest";
import path from "node:path";
import { findLesson, readCatalog } from "./catalog";

const COURSE = path.resolve(__dirname, "../../../tests/fixtures/course");

describe("readCatalog", () => {
  it("находит фазы по порядку номеров", () => {
    const phases = readCatalog(COURSE);
    expect(phases.map((p) => p.number)).toEqual([1, 2]);
    expect(phases[0].title).toBe("Math Foundations");
  });

  it("находит уроки внутри фазы по порядку", () => {
    const [first] = readCatalog(COURSE);
    expect(first.lessons.map((l) => l.lessonDir)).toEqual(["01-alpha", "02-beta"]);
    expect(first.lessons[1].slug).toBe("01-math-foundations__02-beta");
    expect(first.lessons[1].title).toBe("Beta");
    expect(first.lessons[1].lessonNumber).toBe(2);
  });

  it("игнорирует директории без docs/", () => {
    const phases = readCatalog(COURSE);
    const all = phases.flatMap((p) => p.lessons);
    expect(all).toHaveLength(3);
  });
});

describe("findLesson", () => {
  it("находит урок по слагу", () => {
    const ref = findLesson(COURSE, "01-math-foundations__02-beta");
    expect(ref?.lessonDir).toBe("02-beta");
  });

  it("возвращает null для неизвестного слага", () => {
    expect(findLesson(COURSE, "nope__nope")).toBeNull();
  });
});
