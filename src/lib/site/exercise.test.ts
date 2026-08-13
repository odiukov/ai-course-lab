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
});

describe("findLessonExercise", () => {
  it("находит упражнение урока по номерам фазы и урока", () => {
    const bundle = findLessonExercise(sourceDir, "01-math-foundations__04-calculus-for-ml")!;

    expect(bundle.slug).toBe("p01-l04-calculus-for-ml");
    expect(bundle.functions).toEqual(["magnitude", "dot"]);
    expect(bundle.solutionPath).toBeNull();
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

    expect(bundle.solutionPath).not.toBeNull();
    expect(exerciseUrls("/base", bundle).solution).toBe(
      "/base/exercise/p01-l04-calculus-for-ml/solution.py",
    );
    expect(exerciseFiles(bundle).map((file) => file.to)).toContain(
      "exercise/p01-l04-calculus-for-ml/solution.py",
    );
  });
});
