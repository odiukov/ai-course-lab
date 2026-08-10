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

describe("readWrittenFunctions — многострочные сигнатуры и краевые случаи", () => {
  it("видит функцию с многострочной сигнатурой и настоящим телом, сигнатура склеена в одну строку", () => {
    const source = `def adamw_step(
    params, grads, m, v, t, lr=0.001, beta1=0.9, beta2=0.999, eps=1e-8, weight_decay=0.01
):
    """AdamW update."""
    return params
`;
    const dir = makeSource({ "learning-exercises/p03-l06-optimizers/exercise.py": source });
    const written = readWrittenFunctions(dir);
    expect(written.map((w) => w.fn)).toEqual(["adamw_step"]);
    expect(written[0].signature).toBe(
      "adamw_step(params, grads, m, v, t, lr=0.001, beta1=0.9, beta2=0.999, eps=1e-8, weight_decay=0.01)",
    );
  });

  it("не считает написанной функцию с многострочной сигнатурой, если тело — заглушка", () => {
    const source = `def stub_multiline(
    a, b
):
    raise NotImplementedError
`;
    const dir = makeSource({ "learning-exercises/p03-l06-optimizers/exercise.py": source });
    expect(readWrittenFunctions(dir)).toEqual([]);
  });

  it("не теряет функцию, определённую прямо перед функцией с многострочной сигнатурой", () => {
    const source = `def before_fn(x):
    return x + 1


def adamw_step(
    params, grads
):
    """AdamW update."""
    return params
`;
    const dir = makeSource({ "learning-exercises/p03-l06-optimizers/exercise.py": source });
    expect(readWrittenFunctions(dir).map((w) => w.fn)).toEqual(["before_fn", "adamw_step"]);
  });

  it("не считает написанной заглушку с докстрингом в одинарных тройных кавычках", () => {
    const source = `def bad_docstring(x):
    '''Stub with single-quote docstring.'''
    raise NotImplementedError
`;
    const dir = makeSource({ "learning-exercises/p01-l02-beta/exercise.py": source });
    expect(readWrittenFunctions(dir)).toEqual([]);
  });

  it("видит написанную async def функцию", () => {
    const source = `async def fetch_data(url):
    """Fetch async."""
    return await something(url)
`;
    const dir = makeSource({ "learning-exercises/p01-l02-beta/exercise.py": source });
    expect(readWrittenFunctions(dir).map((w) => w.fn)).toEqual(["fetch_data"]);
  });
});
