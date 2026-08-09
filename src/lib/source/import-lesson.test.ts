import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findLesson } from "./catalog";
import { importLesson, isImported } from "./import-lesson";

const COURSE = path.resolve(__dirname, "../../../tests/fixtures/course");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "import-"));
}

function beta() {
  return findLesson(COURSE, "01-math-foundations__02-beta")!;
}

describe("importLesson", () => {
  it("переносит текст, перевод, квиз, визуализацию и упражнение", () => {
    const sourceDir = tmp();
    const result = importLesson(COURSE, sourceDir, beta());

    const exists = (rel: string) => fs.existsSync(path.join(sourceDir, rel));
    expect(exists("phases/01-math-foundations/02-beta/docs/en.md")).toBe(true);
    expect(exists("phases/01-math-foundations/02-beta/quiz.json")).toBe(true);
    expect(exists("i18n/ru/phases/01-math-foundations/02-beta/docs/ru.md")).toBe(true);
    expect(exists("learning-visuals/lesson-02-shapes.html")).toBe(true);
    expect(exists("learning-exercises/p01-l02-beta/exercise.template.py")).toBe(true);
    expect(exists("learning-exercises/p01-l02-beta/test_exercise.py")).toBe(true);
    expect(result.copied.length).toBeGreaterThan(5);
  });

  it("не тащит визуализации и упражнения чужих уроков", () => {
    const sourceDir = tmp();
    importLesson(COURSE, sourceDir, findLesson(COURSE, "01-math-foundations__01-alpha")!);
    expect(fs.existsSync(path.join(sourceDir, "learning-visuals"))).toBe(false);
    expect(fs.existsSync(path.join(sourceDir, "learning-exercises"))).toBe(false);
  });

  it("не перетирает уже импортированные файлы", () => {
    const sourceDir = tmp();
    importLesson(COURSE, sourceDir, beta());
    const mine = path.join(sourceDir, "phases/01-math-foundations/02-beta/docs/en.md");
    fs.writeFileSync(mine, "мой правленый текст", "utf8");

    const again = importLesson(COURSE, sourceDir, beta());
    expect(fs.readFileSync(mine, "utf8")).toBe("мой правленый текст");
    expect(again.copied).toEqual([]);
    expect(again.skipped.length).toBeGreaterThan(5);
  });
});

describe("isImported", () => {
  it("различает импортированный и неимпортированный урок", () => {
    const sourceDir = tmp();
    expect(isImported(sourceDir, beta())).toBe(false);
    importLesson(COURSE, sourceDir, beta());
    expect(isImported(sourceDir, beta())).toBe(true);
  });
});
