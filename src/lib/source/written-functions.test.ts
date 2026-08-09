import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readWrittenFunctions } from "./written-functions";

function makeSource(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "written-"));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
  return dir;
}

const WRITTEN = `def transpose(M):
    """Переворачивает матрицу."""
    return [list(row) for row in zip(*M)]


def matmul(A, B):
    """Умножение."""
    raise NotImplementedError


def identity(n):
    pass


def _helper(x):
    return x
`;

describe("readWrittenFunctions", () => {
  it("считает написанной только функцию с настоящим телом", () => {
    const dir = makeSource({ "learning-exercises/p01-l02-beta/exercise.py": WRITTEN });
    expect(readWrittenFunctions(dir).map((w) => w.fn)).toEqual(["transpose"]);
  });

  it("запоминает упражнение и сигнатуру", () => {
    const dir = makeSource({ "learning-exercises/p01-l02-beta/exercise.py": WRITTEN });
    const [first] = readWrittenFunctions(dir);
    expect(first.exerciseSlug).toBe("p01-l02-beta");
    expect(first.signature).toBe("transpose(M)");
  });

  it("привязывает функцию к уроку, когда урок импортирован", () => {
    const dir = makeSource({
      "learning-exercises/p01-l02-beta/exercise.py": WRITTEN,
      "phases/01-math-foundations/02-beta/docs/en.md": "# Beta",
    });
    expect(readWrittenFunctions(dir)[0].lessonSlug).toBe("01-math-foundations__02-beta");
  });

  it("отдаёт null вместо урока, если урок ещё не импортирован", () => {
    const dir = makeSource({ "learning-exercises/p01-l02-beta/exercise.py": WRITTEN });
    expect(readWrittenFunctions(dir)[0].lessonSlug).toBeNull();
  });

  it("игнорирует шаблон — учитывается только exercise.py", () => {
    const dir = makeSource({
      "learning-exercises/p01-l02-beta/exercise.template.py": WRITTEN,
    });
    expect(readWrittenFunctions(dir)).toEqual([]);
  });

  it("на пустом проекте отдаёт пустой список", () => {
    expect(readWrittenFunctions(makeSource({}))).toEqual([]);
  });
});
