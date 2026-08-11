import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LessonRef } from "../source/catalog";
import {
  exerciseDirName,
  generateExercise,
  parseExerciseReply,
  validateExercise,
  writeExercise,
  type ExerciseFiles,
} from "./write-exercise";

const REF: LessonRef = {
  slug: "01-math-foundations__02-vectors-matrices-operations",
  phaseDir: "01-math-foundations",
  lessonDir: "02-vectors-matrices-operations",
  phaseNumber: 1,
  lessonNumber: 2,
  title: "Vectors Matrices Operations",
};

const TEMPLATE = `"""Урок."""


def magnitude(v):
    """Длина вектора."""
    raise NotImplementedError


def dot(a, b):
    """Скалярное произведение."""
    raise NotImplementedError
`;

const SOLUTION = `import math


def magnitude(v):
    return math.sqrt(sum(x * x for x in v))


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))
`;

const TESTS = `from exercise import dot, magnitude


def test_magnitude():
    assert magnitude([3, 4]) == 5


def test_dot():
    assert dot([1, 2], [3, 4]) == 11
`;

const FILES: ExerciseFiles = { template: TEMPLATE, solution: SOLUTION, tests: TESTS };

function reply(files: ExerciseFiles): string {
  return [
    "```python name=exercise.template.py",
    files.template,
    "```",
    "",
    "```python name=solution.py",
    files.solution,
    "```",
    "",
    "```python name=test_exercise.py",
    files.tests,
    "```",
  ].join("\n");
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "exgen-"));
}

const passes = async () => null;

describe("parseExerciseReply", () => {
  it("разбирает три помеченных блока", () => {
    const parsed = parseExerciseReply(reply(FILES));
    expect("error" in parsed).toBe(false);
    expect((parsed as ExerciseFiles).solution).toContain("math.sqrt");
  });

  // Порядок блоков агент путает, поэтому файлы узнаются по метке, а не по
  // месту: принять решение за шаблон значит выдать учащемуся готовый ответ.
  it("узнаёт файлы по метке, а не по порядку", () => {
    const shuffled = [
      "```python name=test_exercise.py",
      TESTS,
      "```",
      "```python name=solution.py",
      SOLUTION,
      "```",
      "```python name=exercise.template.py",
      TEMPLATE,
      "```",
    ].join("\n");
    const parsed = parseExerciseReply(shuffled) as ExerciseFiles;
    expect(parsed.template).toContain("NotImplementedError");
    expect(parsed.solution).toContain("math.sqrt");
  });

  it("жалуется на недостающий файл поимённо", () => {
    const partial = ["```python name=solution.py", SOLUTION, "```"].join("\n");
    const parsed = parseExerciseReply(partial);
    expect("error" in parsed && parsed.error).toContain("exercise.template.py");
  });
});

describe("validateExercise", () => {
  it("пропускает согласованную тройку", () => {
    expect(validateExercise(FILES)).toBeNull();
  });

  it("ловит расхождение состава функций", () => {
    const solution = `${SOLUTION}\n\ndef extra(x):\n    return x\n`;
    expect(validateExercise({ ...FILES, solution })).toMatch(/разные функции/);
  });

  // Худший из провалов: упражнение выглядит выданным, а решать нечего.
  it("ловит готовое решение в шаблоне", () => {
    const template = TEMPLATE.replace("    raise NotImplementedError", "    return 5");
    expect(validateExercise({ ...FILES, template })).toMatch(/уже написаны/);
  });

  it("ловит нереализованную функцию в решении", () => {
    const solution = SOLUTION.replace(
      "    return sum(x * y for x, y in zip(a, b))",
      "    raise NotImplementedError",
    );
    expect(validateExercise({ ...FILES, solution })).toMatch(/не реализованы/);
  });

  it("ловит тесты без импорта из exercise", () => {
    const tests = TESTS.replace("from exercise import dot, magnitude", "import math");
    expect(validateExercise({ ...FILES, tests })).toMatch(/не импортируют/);
  });

  it("ловит функцию, которую тесты не трогают", () => {
    const tests = TESTS.replace("def test_dot():\n    assert dot([1, 2], [3, 4]) == 11\n", "");
    expect(validateExercise({ ...FILES, tests })).toMatch(/dot/);
  });
});

describe("exerciseDirName", () => {
  it("собирает имя по правилам курса", () => {
    expect(exerciseDirName(REF)).toBe("p01-l02-vectors-matrices-operations");
  });
});

describe("writeExercise", () => {
  it("кладёт четыре файла и не создаёт exercise.py", async () => {
    const sourceDir = tmpDir();
    const result = await writeExercise({ sourceDir, ref: REF, files: FILES, check: passes });

    expect("error" in result).toBe(false);
    const dir = path.join(sourceDir, "learning-exercises", "p01-l02-vectors-matrices-operations");
    expect(fs.readdirSync(dir).sort()).toEqual([
      "exercise.template.py",
      "pytest.ini",
      "solution.py",
      "test_exercise.py",
    ]);
    expect((result as { functions: string[] }).functions).toEqual(["magnitude", "dot"]);
  });

  // Упражнение, чьи тесты не проходят на авторском решении, нерешаемо в
  // принципе. Узнать об этом, сев за него, — худший способ.
  it("не пишет ничего, если тесты не прошли на решении", async () => {
    const sourceDir = tmpDir();
    const result = await writeExercise({
      sourceDir,
      ref: REF,
      files: FILES,
      check: async () => "1 failed",
    });

    expect("error" in result && result.error).toContain("авторском решении");
    expect(fs.existsSync(path.join(sourceDir, "learning-exercises"))).toBe(false);
  });

  it("прогоняет тесты против решения, а не против шаблона", async () => {
    const seen: string[] = [];
    await writeExercise({
      sourceDir: tmpDir(),
      ref: REF,
      files: FILES,
      check: async (dir) => {
        seen.push(fs.readFileSync(path.join(dir, "exercise.py"), "utf8"));
        return null;
      },
    });
    expect(seen[0]).toContain("math.sqrt");
    expect(seen[0]).not.toContain("NotImplementedError");
  });
});

describe("generateExercise", () => {
  const source = {
    ref: REF,
    lang: "ru" as const,
    textPath: "x.md",
    text: "Текст урока про векторы.",
    sourceHash: "hash",
    quiz: [],
    visuals: [],
    exercise: null,
  };

  it("пишет упражнение с первой попытки", async () => {
    const sourceDir = tmpDir();
    const run = vi.fn().mockResolvedValue(reply(FILES));
    const result = await generateExercise({ sourceDir, source, deps: { run }, check: passes });

    expect("error" in result).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("после отказа просит переделать и принимает вторую попытку", async () => {
    const sourceDir = tmpDir();
    const broken = { ...FILES, template: TEMPLATE.replace("    raise NotImplementedError", "    return 5") };
    const run = vi
      .fn()
      .mockResolvedValueOnce(reply(broken))
      .mockResolvedValueOnce(reply(FILES));

    const result = await generateExercise({ sourceDir, source, deps: { run }, check: passes });

    expect("error" in result).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toContain("уже написаны");
  });

  it("после двух отказов возвращает причину, а не мусор на диске", async () => {
    const sourceDir = tmpDir();
    const run = vi.fn().mockResolvedValue("никаких блоков тут нет");
    const result = await generateExercise({ sourceDir, source, deps: { run }, check: passes });

    expect("error" in result && result.error).toContain("нет файлов");
    expect(fs.existsSync(path.join(sourceDir, "learning-exercises"))).toBe(false);
  });
});
