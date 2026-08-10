import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  describeFunctions,
  readCanonicalFunctions,
  readExerciseCodeBySlug,
} from "@/lib/exercise/file";
import type { LessonRef } from "@/lib/source/catalog";
import { PracticeError } from "./errors";
import { buildTestFilter, runTests } from "./run-tests";

const FAKE = path.join(process.cwd(), "tests/fixtures/practice/fake-python.mjs");

// Функции настоящего упражнения урока 02 в том порядке, в котором их отдаёт
// describeFunctions, — и порядок шагов, в котором учащийся их пишет.
const LESSON02 = ["transpose", "matmul", "identity", "trace", "is_symmetric", "hadamard"];

const LESSON02_REF: LessonRef = {
  slug: "01-math__02-matrices",
  phaseDir: "01-math",
  lessonDir: "02-matrices",
  phaseNumber: 1,
  lessonNumber: 2,
  title: "Матрицы",
};

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-tests-"));
  fs.writeFileSync(path.join(dir, "test_exercise.py"), "# заглушка\n", "utf8");
  return dir;
}

// Гоняет подделку интерпретатора на настоящих именах тестов урока 02 и
// отдаёт имена, которые выражение -k отобрало на ПЕРВОМ прогоне (второй, если
// он был, — это уже откат на весь файл).
async function selection(fn: string, functions: string[] = LESSON02) {
  process.env.FAKE_PYTHON_MODE = "lesson02";
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lab-select-")), "selected.txt");
  process.env.FAKE_PYTHON_SELECTED = log;
  const result = await runTests({ dir: makeDir(), fn, functions, python: FAKE });
  // Одна строка на прогон, каждая заканчивается \n — поэтому последний,
  // пустой, элемент split отбрасывается, а строка пустого отбора остаётся.
  const runs = fs
    .readFileSync(log, "utf8")
    .split("\n")
    .slice(0, -1)
    .map((line) => line.split(",").filter((name) => name.length > 0));
  return { result, first: runs[0] ?? [], runs };
}

afterEach(() => {
  delete process.env.FAKE_PYTHON_MODE;
  delete process.env.FAKE_PYTHON_SELECTED;
});

describe("buildTestFilter", () => {
  it("без соседних функций фильтр — просто имя", () => {
    expect(buildTestFilter("transpose", ["transpose"])).toBe("transpose");
    expect(buildTestFilter("transpose")).toBe("transpose");
  });

  it("отрицает все остальные функции упражнения", () => {
    expect(buildTestFilter("hadamard", LESSON02)).toBe(
      "hadamard and not (transpose or matmul or identity or trace or is_symmetric)",
    );
  });

  it("не отрицает имя, которое само является подстрокой нужного", () => {
    // Иначе `matmul` в отрицании обнулил бы отбор для `matmul_fast` целиком.
    expect(buildTestFilter("matmul_fast", ["matmul", "matmul_fast"])).toBe("matmul_fast");
  });
});

describe("runTests: отбор на настоящих именах тестов урока 02", () => {
  it("hadamard не тянет за собой тест, который зовёт ещё не написанный matmul", async () => {
    const { result, first } = await selection("hadamard");
    expect(first).toEqual([
      "test_hadamard_scales_elementwise",
      "test_hadamard_with_zero_mask_zeroes_everything",
    ]);
    expect(first).not.toContain("test_hadamard_differs_from_matmul");
    expect(result).toMatchObject({ total: 2, passed: 2, filtered: true, warning: null });
  });

  it("identity не тянет тесты matmul, trace и симметрии", async () => {
    const { result, first } = await selection("identity");
    expect(first).toEqual(["test_identity_shape_and_content", "test_identity_of_one"]);
    expect(result).toMatchObject({ total: 2, filtered: true, warning: null });
  });

  it("is_symmetric: ни одного своего теста — весь файл и предупреждение, а не ложное «1 из 1»", async () => {
    // test_symmetric_true/false не содержат `is_symmetric`, а единственное
    // совпадение — test_identity_is_symmetric — отрезано отрицанием identity.
    const { result, runs } = await selection("is_symmetric");
    expect(runs[0]).toEqual([]);
    expect(result.filtered).toBe(false);
    expect(result.warning).toContain("is_symmetric");
    expect(result.total).toBe(17);
  });

  it("transpose отбирает все три своих теста", async () => {
    const { first } = await selection("transpose");
    expect(first).toEqual([
      "test_transpose_rectangular",
      "test_transpose_twice_returns_original",
      "test_transpose_returns_lists_not_tuples",
    ]);
  });

  it("matmul не гоняет тест, которому нужна ещё не написанная identity", async () => {
    const { first } = await selection("matmul");
    expect(first).toEqual([
      "test_matmul_row_by_column",
      "test_matmul_shapes_2x3_by_3x2",
      "test_matmul_is_not_commutative",
    ]);
  });
});

// Откуда берётся список «остальных функций» — не деталь реализации, а разница
// между честным прогоном и ложным зелёным. Список собирается из шаблона
// упражнения (readCanonicalFunctions), потому что учащийся в свой exercise.py
// дописывает вспомогательные функции, и они не должны попадать в отрицание -k.
describe("состав упражнения для фильтра берётся из шаблона, а не из файла учащегося", () => {
  function makeLesson02Source(): string {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-canon-"));
    const dir = path.join(sourceDir, "learning-exercises", "p01-l02-matrices");
    fs.mkdirSync(dir, { recursive: true });
    const template = LESSON02.map((fn) => `def ${fn}(M):\n    raise NotImplementedError\n`).join("\n\n");
    fs.writeFileSync(path.join(dir, "exercise.template.py"), `${template}\n`, "utf8");
    // Так выглядит файл учащегося на шаге identity: три функции написаны, и
    // рядом лежит его собственная вспомогательная `shape`.
    const solved = `${LESSON02.map((fn) => `def ${fn}(M):\n    return shape(M)\n`).join("\n\n")}\n\ndef shape(M):\n    return len(M), len(M[0])\n`;
    fs.writeFileSync(path.join(dir, "exercise.py"), solved, "utf8");
    return sourceDir;
  }

  it("вспомогательная `shape` учащегося не отрезает test_identity_shape_and_content", async () => {
    const sourceDir = makeLesson02Source();
    const canonical = readCanonicalFunctions(sourceDir, LESSON02_REF);
    expect(canonical).toEqual(LESSON02);

    const { result, first } = await selection("identity", canonical);
    expect(first).toEqual(["test_identity_shape_and_content", "test_identity_of_one"]);
    expect(result).toMatchObject({ total: 2, passed: 2, filtered: true, warning: null });
  });

  it("состав из живого файла дал бы ложное «1 из 1 зелёные»", async () => {
    const sourceDir = makeLesson02Source();
    const live = describeFunctions(readExerciseCodeBySlug(sourceDir, "p01-l02-matrices")!).map(
      (item) => item.fn,
    );
    expect(live).toContain("shape");

    const { result, first } = await selection("identity", live);
    // Ровно тот дефект: настоящий тест шага отрезан отрицанием `shape`, а
    // прогон при этом выглядит зелёным и отфильтрованным, без предупреждения.
    expect(first).not.toContain("test_identity_shape_and_content");
    expect(result).toMatchObject({ total: 1, passed: 1, filtered: true, warning: null });
  });
});

describe("runTests", () => {
  it("зелёный прогон: считает пройденные и не выдумывает предупреждений", async () => {
    const result = await runTests({ dir: makeDir(), fn: "transpose", python: FAKE });
    expect(result).toMatchObject({ total: 2, passed: 2, failed: 0, filtered: true, warning: null });
    expect(result.command).toContain('-k "transpose"');
  });

  it("красный прогон: отдаёт первый упавший с решающей строкой", async () => {
    process.env.FAKE_PYTHON_MODE = "red";
    const result = await runTests({ dir: makeDir(), fn: "transpose", python: FAKE });
    expect(result.failed).toBe(1);
    expect(result.failures[0].name).toBe("test_transpose_twice_returns_original");
    expect(result.failures[0].decisive).toContain("assert 0 == 32");
  });

  it("если -k не дал тестов, гоняет весь файл и предупреждает", async () => {
    process.env.FAKE_PYTHON_MODE = "empty-filter";
    const result = await runTests({ dir: makeDir(), fn: "nosuch", python: FAKE });
    expect(result.total).toBe(2);
    expect(result.filtered).toBe(false);
    expect(result.warning).toContain("nosuch");
  });

  it("интерпретатор без pytest — это PracticeError, а не пустой прогон", async () => {
    process.env.FAKE_PYTHON_MODE = "missing-pytest";
    await expect(runTests({ dir: makeDir(), python: FAKE })).rejects.toMatchObject({
      name: "PracticeError",
      kind: "python",
    });
  });

  it("несуществующий интерпретатор даёт kind spawn", async () => {
    await expect(
      runTests({ dir: makeDir(), python: path.join(os.tmpdir(), "no-such-python") }),
    ).rejects.toMatchObject({ kind: "spawn" });
  });

  it("зависший прогон убивается по таймауту", async () => {
    process.env.FAKE_PYTHON_MODE = "hang";
    await expect(
      runTests({ dir: makeDir(), python: FAKE, timeoutMs: 300 }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("PracticeError несёт человеческое сообщение по-русски", async () => {
    process.env.FAKE_PYTHON_MODE = "missing-pytest";
    try {
      await runTests({ dir: makeDir(), python: FAKE });
      throw new Error("ожидался reject от runTests");
    } catch (e) {
      const error = e as PracticeError;
      expect(error.message).toMatch(/pytest/i);
    }
  });
});
