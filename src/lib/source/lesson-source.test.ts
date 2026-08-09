import { describe, expect, it } from "vitest";
import path from "node:path";
import { findLesson } from "./catalog";
import { readLessonSource } from "./lesson-source";

const COURSE = path.resolve(__dirname, "../../../tests/fixtures/course");

function source(slug: string) {
  const ref = findLesson(COURSE, slug)!;
  return readLessonSource(COURSE, ref);
}

describe("readLessonSource", () => {
  it("предпочитает русский перевод, если он есть", () => {
    const src = source("01-math-foundations__02-beta");
    expect(src.lang).toBe("ru");
    expect(src.text).toContain("Транспонирование");
  });

  it("откатывается на английский, если перевода нет", () => {
    const src = source("01-math-foundations__01-alpha");
    expect(src.lang).toBe("en");
    expect(src.text).toContain("Alpha is the first idea");
  });

  it("считает стабильный хеш от текста", () => {
    const a = source("01-math-foundations__02-beta").sourceHash;
    const b = source("01-math-foundations__02-beta").sourceHash;
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(source("01-math-foundations__01-alpha").sourceHash);
  });

  it("читает квиз", () => {
    expect(source("01-math-foundations__02-beta").quiz).toHaveLength(1);
    expect(source("01-math-foundations__01-alpha").quiz).toEqual([]);
  });

  it("находит визуализации по номеру урока", () => {
    expect(source("01-math-foundations__02-beta").visuals)
      .toEqual(["learning-visuals/lesson-02-shapes.html"]);
    // alpha — фаза 1, урок 1: легаси-имя lesson-01-* однозначно принадлежит
    // ей по правилам фазы 1.
    expect(source("01-math-foundations__01-alpha").visuals)
      .toEqual(["learning-visuals/lesson-01-gamma-demo.html"]);
  });

  it("для визуализаций вне фазы 1 требует полное имя phase+lesson", () => {
    // gamma — фаза 2, урок 1. Лёгаси-имя lesson-01-* принадлежит только
    // фазе 1 и не подходит; находится только phase-qualified файл.
    expect(source("02-ml-fundamentals__01-gamma").visuals)
      .toEqual(["learning-visuals/p02-l01-gamma.html"]);
  });

  it("находит упражнение и публичные функции", () => {
    const ex = source("01-math-foundations__02-beta").exercise!;
    expect(ex.slug).toBe("p01-l02-beta");
    expect(ex.functions).toEqual(["transpose", "matmul"]);
  });

  it("отдаёт null, если упражнения нет", () => {
    expect(source("01-math-foundations__01-alpha").exercise).toBeNull();
  });
});
