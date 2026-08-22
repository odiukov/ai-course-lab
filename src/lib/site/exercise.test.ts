import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exerciseFiles, exerciseUrls, findLessonExercise } from "./exercise";

let root: string;
let sourceDir: string;

const template = `import math


def magnitude(v):
    raise NotImplementedError


def dot(a, b):
    raise NotImplementedError
`;

// Временные каталоги, созданные тестами каталожной/одно-файловой формы ниже
// (`makeMulti`, `makeSingle`) — у них своё дерево, отдельное от `root`.
const extraRoots: string[] = [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "site-exercise-"));
  sourceDir = path.join(root, "source");
  const dir = path.join(sourceDir, "learning-exercises", "p01-l04-calculus-for-ml");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "exercise.template.py"), template);
  fs.writeFileSync(path.join(dir, "test_exercise.py"), "def test_magnitude_basic(): pass\n");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  for (const dir of extraRoots) fs.rmSync(dir, { recursive: true, force: true });
  extraRoots.length = 0;
});

describe("findLessonExercise", () => {
  it("находит упражнение урока по номерам фазы и урока", () => {
    const bundle = findLessonExercise(sourceDir, "01-math-foundations__04-calculus-for-ml")!;

    expect(bundle.slug).toBe("p01-l04-calculus-for-ml");
    expect(bundle.functions).toEqual(["magnitude", "dot"]);
    expect(bundle.files).toHaveLength(1);
    expect(bundle.files[0].solutionPath).toBeNull();
  });

  it("возвращает null, когда упражнения у урока нет", () => {
    expect(findLessonExercise(sourceDir, "09-nonexistent__01-nothing")).toBeNull();
  });

  it("возвращает null, когда нет тестов", () => {
    // Писать без проверки нечего: панель без тестов бесполезна.
    fs.rmSync(
      path.join(sourceDir, "learning-exercises", "p01-l04-calculus-for-ml", "test_exercise.py"),
    );

    expect(findLessonExercise(sourceDir, "01-math-foundations__04-calculus-for-ml")).toBeNull();
  });

  it("подхватывает эталон, если он есть", () => {
    const dir = path.join(sourceDir, "learning-exercises", "p01-l04-calculus-for-ml");
    fs.writeFileSync(path.join(dir, "solution.py"), "def magnitude(v): return 0\n");

    const bundle = findLessonExercise(sourceDir, "01-math-foundations__04-calculus-for-ml")!;

    expect(bundle.files[0].solutionPath).not.toBeNull();
    expect(exerciseUrls("/base", bundle).solution).toBe(
      "/base/exercise/p01-l04-calculus-for-ml/solution.py",
    );
    expect(exerciseFiles(bundle).map((file) => file.to)).toContain(
      "exercise/p01-l04-calculus-for-ml/solution.py",
    );
  });
});

/**
 * Многофайловое упражнение: `main.py` + `events.py` + `hooks.py`, эталон
 * только у `main.py` — обычная картина, когда остальные файлы даны целиком.
 */
function makeMulti(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "site-exercise-multi-"));
  extraRoots.push(tmp);

  const dir = path.join(tmp, "learning-exercises", "p19-l20-loop");
  const templateDir = path.join(dir, "exercise.template");
  fs.mkdirSync(templateDir, { recursive: true });
  fs.writeFileSync(path.join(templateDir, "main.py"), "def run():\n    raise NotImplementedError\n");
  fs.writeFileSync(
    path.join(templateDir, "events.py"),
    "def emit():\n    raise NotImplementedError\n",
  );
  fs.writeFileSync(path.join(templateDir, "hooks.py"), "def fire():\n    raise NotImplementedError\n");
  fs.writeFileSync(path.join(dir, "test_exercise.py"), "def test_run(): pass\n");

  const solutionDir = path.join(dir, "solution");
  fs.mkdirSync(solutionDir, { recursive: true });
  fs.writeFileSync(path.join(solutionDir, "main.py"), "def run():\n    return None\n");

  return tmp;
}

/** Одно-файловое упражнение — старая форма, которой должно быть не всё равно. */
function makeSingle(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "site-exercise-single-"));
  extraRoots.push(tmp);

  const dir = path.join(tmp, "learning-exercises", "p01-l02-beta");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "exercise.template.py"), "def beta():\n    raise NotImplementedError\n");
  fs.writeFileSync(path.join(dir, "test_exercise.py"), "def test_beta(): pass\n");

  return tmp;
}

describe("exerciseFiles", () => {
  it("собирает адреса всех файлов многофайлового упражнения", () => {
    const bundle = findLessonExercise(makeMulti(), "19-capstone-projects__20-loop")!;
    expect(exerciseFiles(bundle).map((item) => item.to)).toEqual([
      "exercise/p19-l20-loop/template/main.py",
      "exercise/p19-l20-loop/template/events.py",
      "exercise/p19-l20-loop/template/hooks.py",
      "exercise/p19-l20-loop/test.py",
      "exercise/p19-l20-loop/tests/test_exercise.py",
      "exercise/p19-l20-loop/solution/main.py",
    ]);
  });

  it("одно-файловое упражнение раскладывается как раньше", () => {
    const bundle = findLessonExercise(makeSingle(), "01-math__02-beta")!;
    expect(exerciseFiles(bundle).map((item) => item.to)).toEqual([
      "exercise/p01-l02-beta/template.py",
      "exercise/p01-l02-beta/test.py",
    ]);
  });
});
