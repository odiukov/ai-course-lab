import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findLesson } from "./catalog";
import { importLesson, isImported, isLearnerOwned } from "./import-lesson";

const COURSE = path.resolve(__dirname, "../../../tests/fixtures/course");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "import-"));
}

function beta() {
  return findLesson(COURSE, "01-math-foundations__02-beta")!;
}

function gamma() {
  return findLesson(COURSE, "02-ml-fundamentals__01-gamma")!;
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
    const result = importLesson(COURSE, sourceDir, findLesson(COURSE, "01-math-foundations__01-alpha")!);
    // alpha — фаза 1, урок 1: легаси-имя lesson-01-* однозначно принадлежит
    // ей по правилам фазы 1, поэтому копируется. Но phase-qualified файл
    // другого урока (p02-l01-gamma.html) и чужие упражнения не появляются.
    const visuals = result.copied.filter((rel) => rel.startsWith("learning-visuals/"));
    expect(visuals).toEqual(["learning-visuals/lesson-01-gamma-demo.html"]);
    expect(fs.existsSync(path.join(sourceDir, "learning-exercises"))).toBe(false);
  });

  it("не путает лёгаси-имя визуализации другой фазы с тем же номером урока", () => {
    const sourceDir = tmp();
    const result = importLesson(COURSE, sourceDir, gamma());
    // gamma — это phase 2, lesson 1. Лёгаси-имя lesson-01-* принадлежит
    // только фазе 1, поэтому gamma не должна получить lesson-01-gamma-demo.html.
    expect(fs.existsSync(path.join(sourceDir, "learning-visuals", "lesson-01-gamma-demo.html"))).toBe(false);
    expect(result.copied).not.toContain("learning-visuals/lesson-01-gamma-demo.html");
  });

  it("тащит визуализацию с полным именем phase+lesson", () => {
    const sourceDir = tmp();
    const result = importLesson(COURSE, sourceDir, gamma());
    expect(fs.existsSync(path.join(sourceDir, "learning-visuals", "p02-l01-gamma.html"))).toBe(true);
    const visuals = result.copied.filter((rel) => rel.startsWith("learning-visuals/"));
    expect(visuals).toEqual(["learning-visuals/p02-l01-gamma.html"]);
  });

  it("без overwrite не перетирает уже импортированные файлы", () => {
    const sourceDir = tmp();
    importLesson(COURSE, sourceDir, beta());
    const mine = path.join(sourceDir, "phases/01-math-foundations/02-beta/docs/en.md");
    fs.writeFileSync(mine, "мой правленый текст", "utf8");

    const again = importLesson(COURSE, sourceDir, beta());
    expect(fs.readFileSync(mine, "utf8")).toBe("мой правленый текст");
    expect(again.copied).toEqual([]);
    expect(again.updated).toEqual([]);
    expect(again.kept.length).toBeGreaterThan(5);
  });

  it("с overwrite возвращает расходящийся файл к версии курса", () => {
    const sourceDir = tmp();
    importLesson(COURSE, sourceDir, beta());
    const rel = "phases/01-math-foundations/02-beta/docs/en.md";
    const mine = path.join(sourceDir, rel);
    fs.writeFileSync(mine, "устаревший текст", "utf8");

    const again = importLesson(COURSE, sourceDir, beta(), { overwrite: true });

    expect(fs.readFileSync(mine, "utf8")).toBe(fs.readFileSync(path.join(COURSE, rel), "utf8"));
    expect(again.updated).toContain(rel);
    expect(again.copied).toEqual([]);
  });

  // Единственный файл в наборе, который создаёт лаба и пишет учащийся.
  // Перезапись стёрла бы решение без возможности отката.
  //
  // Курс здесь собирается свой, а не берётся COURSE: в общей фикстуре
  // exercise.py нет, а класть его туда на время теста — значит показывать
  // чужой файл параллельно идущим тестам других файлов.
  it("с overwrite не трогает exercise.py учащегося", () => {
    const courseRepo = tmp();
    const ref = {
      slug: "01-solo__01-owned",
      phaseDir: "01-solo",
      lessonDir: "01-owned",
      phaseNumber: 1,
      lessonNumber: 1,
      title: "Owned",
    };
    const docs = path.join(courseRepo, "phases", ref.phaseDir, ref.lessonDir, "docs");
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, "en.md"), "текст урока", "utf8");
    const exercises = path.join(courseRepo, "learning-exercises", "p01-l01-owned");
    fs.mkdirSync(exercises, { recursive: true });
    fs.writeFileSync(path.join(exercises, "exercise.template.py"), "def solve():\n    pass\n", "utf8");
    fs.writeFileSync(path.join(exercises, "exercise.py"), "def solve():\n    pass\n", "utf8");

    const sourceDir = tmp();
    importLesson(courseRepo, sourceDir, ref);

    const rel = path.join("learning-exercises", "p01-l01-owned", "exercise.py");
    const mine = path.join(sourceDir, rel);
    fs.writeFileSync(mine, "def solve():\n    return 42\n", "utf8");

    const again = importLesson(courseRepo, sourceDir, ref, { overwrite: true });

    expect(fs.readFileSync(mine, "utf8")).toBe("def solve():\n    return 42\n");
    expect(again.updated).not.toContain(rel);
    expect(again.kept).toContain(rel);
  });

  it("совпавший байт-в-байт файл не считается обновлённым", () => {
    const sourceDir = tmp();
    importLesson(COURSE, sourceDir, beta());

    const again = importLesson(COURSE, sourceDir, beta(), { overwrite: true });

    expect(again.updated).toEqual([]);
    expect(again.copied).toEqual([]);
    expect(again.kept.length).toBeGreaterThan(5);
  });

  it("падает, а не угадывает, если под префикс попадают два каталога упражнения", () => {
    const courseRepo = tmp();
    const ref = {
      slug: "01-ambiguous__01-dup",
      phaseDir: "01-ambiguous",
      lessonDir: "01-dup",
      phaseNumber: 1,
      lessonNumber: 1,
      title: "Dup",
    };
    fs.mkdirSync(path.join(courseRepo, "phases", ref.phaseDir, ref.lessonDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(courseRepo, "phases", ref.phaseDir, ref.lessonDir, "docs", "en.md"), "text");
    fs.mkdirSync(path.join(courseRepo, "learning-exercises", "p01-l01-foo"), { recursive: true });
    fs.mkdirSync(path.join(courseRepo, "learning-exercises", "p01-l01-bar"), { recursive: true });

    expect(() => importLesson(courseRepo, tmp(), ref)).toThrow(/p01-l01-foo.*p01-l01-bar|p01-l01-bar.*p01-l01-foo/);
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

describe("isLearnerOwned", () => {
  it("узнаёт exercise.py учащегося и только его", () => {
    expect(isLearnerOwned("learning-exercises/p01-l02-beta/exercise.py")).toBe(true);
    expect(isLearnerOwned("learning-exercises/p01-l02-beta/exercise.template.py")).toBe(false);
    expect(isLearnerOwned("learning-exercises/p01-l02-beta/tests/exercise.py")).toBe(false);
    expect(isLearnerOwned("phases/01-math-foundations/02-beta/docs/exercise.py")).toBe(false);
  });
});
