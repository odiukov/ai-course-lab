import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LessonRef } from "@/lib/source/catalog";
import { resetFunctionToTemplate } from "./reset";

const ref: LessonRef = {
  slug: "01-math__02-beta",
  phaseDir: "01-math",
  lessonDir: "02-beta",
  phaseNumber: 1,
  lessonNumber: 2,
  title: "Beta",
};

const TEMPLATE = [
  '"""Заготовка."""',
  "",
  "",
  "def transpose(M):",
  '    """Транспонирование."""',
  "    raise NotImplementedError",
  "",
  "",
  "def matmul(A, B):",
  '    """Умножение матриц."""',
  "    raise NotImplementedError",
  "",
  "",
  "def identity(n):",
  '    """Единичная матрица."""',
  "    raise NotImplementedError",
  "",
].join("\n");

function makeSource(exercise?: string): { sourceDir: string; file: string } {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-reset-"));
  const dir = path.join(sourceDir, "learning-exercises", "p01-l02-beta");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "exercise.template.py"), TEMPLATE, "utf8");
  const file = path.join(dir, "exercise.py");
  if (exercise !== undefined) fs.writeFileSync(file, exercise, "utf8");
  return { sourceDir, file };
}

function ok(result: ReturnType<typeof resetFunctionToTemplate>): { code: string; mtimeMs: number } {
  if ("error" in result) throw new Error(`ожидался успех, пришло: ${result.error}`);
  return result;
}

describe("resetFunctionToTemplate", () => {
  // Учащийся переписал matmul: доксрока другая, тело своё. Соседи нетронуты.
  const LEARNER = [
    '"""Заготовка."""',
    "",
    "",
    "def transpose(M):",
    '    """Транспонирование."""',
    "    raise NotImplementedError",
    "",
    "",
    "def matmul(A, B):",
    '    """Моё."""',
    "    return 42",
    "",
    "",
    "def identity(n):",
    '    """Единичная матрица."""',
    "    raise NotImplementedError",
    "",
  ].join("\n");

  it("возвращает заготовку на место испорченной функции, не трогая соседей", () => {
    const { sourceDir, file } = makeSource(LEARNER);

    const result = ok(resetFunctionToTemplate(sourceDir, ref, "matmul"));

    expect(result.code).toBe(TEMPLATE);
    expect(fs.readFileSync(file, "utf8")).toBe(TEMPLATE);
  });

  it("возвращает снесённую функцию на её место по порядку шаблона", () => {
    // Учащийся стёр matmul целиком: заготовка обязана встать между transpose и
    // identity, а не уехать в конец файла.
    const withoutMatmul = [
      '"""Заготовка."""',
      "",
      "",
      "def transpose(M):",
      '    """Транспонирование."""',
      "    raise NotImplementedError",
      "",
      "",
      "def identity(n):",
      '    """Единичная матрица."""',
      "    raise NotImplementedError",
      "",
    ].join("\n");
    const { sourceDir } = makeSource(withoutMatmul);

    const result = ok(resetFunctionToTemplate(sourceDir, ref, "matmul"));

    expect(result.code).toBe(TEMPLATE);
  });

  it("убирает обломки, оставшиеся от снесённой строки def", () => {
    // Самый частый несчастный случай: стёрта одна строка `def matmul(A, B):`.
    // Тело осталось висеть в файле и по отступу приклеилось к transpose — с ним
    // transpose падает на чужом raise. Возвращать matmul, не убрав обломки,
    // бессмысленно.
    const beheaded = [
      '"""Заготовка."""',
      "",
      "",
      "def transpose(M):",
      '    """Транспонирование."""',
      "    raise NotImplementedError",
      "",
      "",
      '    """Умножение матриц."""',
      "    raise NotImplementedError",
      "",
      "",
      "def identity(n):",
      '    """Единичная матрица."""',
      "    raise NotImplementedError",
      "",
    ].join("\n");
    const { sourceDir } = makeSource(beheaded);

    const result = ok(resetFunctionToTemplate(sourceDir, ref, "matmul"));

    expect(result.code).toBe(TEMPLATE);
  });

  it("сохраняет написанный код, если от снесённой функции осталось не тело заготовки", () => {
    // Те же обломки, но внутри — работа учащегося. Стереть её молча нельзя:
    // это единственная копия, и отменить сброс нечем.
    const beheaded = [
      '"""Заготовка."""',
      "",
      "",
      "def transpose(M):",
      '    """Транспонирование."""',
      "    raise NotImplementedError",
      "",
      "",
      "    return 42",
      "",
      "",
      "def identity(n):",
      '    """Единичная матрица."""',
      "    raise NotImplementedError",
      "",
    ].join("\n");
    const { sourceDir } = makeSource(beheaded);

    const result = ok(resetFunctionToTemplate(sourceDir, ref, "matmul"));

    expect(result.code).toContain("    return 42");
    expect(result.code).toBe(
      [
        '"""Заготовка."""',
        "",
        "",
        "def transpose(M):",
        '    """Транспонирование."""',
        "    raise NotImplementedError",
        "",
        "",
        "    return 42",
        "",
        "",
        "def matmul(A, B):",
        '    """Умножение матриц."""',
        "    raise NotImplementedError",
        "",
        "",
        "def identity(n):",
        '    """Единичная матрица."""',
        "    raise NotImplementedError",
        "",
      ].join("\n"),
    );
  });

  it("дописывает в конец функцию, за которой в шаблоне никого нет", () => {
    const withoutIdentity = [
      '"""Заготовка."""',
      "",
      "",
      "def transpose(M):",
      '    """Транспонирование."""',
      "    raise NotImplementedError",
      "",
      "",
      "def matmul(A, B):",
      '    """Умножение матриц."""',
      "    raise NotImplementedError",
      "",
    ].join("\n");
    const { sourceDir } = makeSource(withoutIdentity);

    const result = ok(resetFunctionToTemplate(sourceDir, ref, "identity"));

    expect(result.code).toBe(TEMPLATE);
  });

  it("встаёт перед следующей уцелевшей функцией, если ближайшая соседка тоже снесена", () => {
    const onlyIdentity = [
      '"""Заготовка."""',
      "",
      "",
      "def identity(n):",
      '    """Единичная матрица."""',
      "    raise NotImplementedError",
      "",
    ].join("\n");
    const { sourceDir } = makeSource(onlyIdentity);

    const result = ok(resetFunctionToTemplate(sourceDir, ref, "transpose"));

    expect(result.code).toBe(
      [
        '"""Заготовка."""',
        "",
        "",
        "def transpose(M):",
        '    """Транспонирование."""',
        "    raise NotImplementedError",
        "",
        "",
        "def identity(n):",
        '    """Единичная матрица."""',
        "    raise NotImplementedError",
        "",
      ].join("\n"),
    );
  });

  it("отдаёт новый mtime — редактору с ним дальше сохранять", () => {
    const { sourceDir, file } = makeSource(LEARNER);
    const before = fs.statSync(file).mtimeMs;

    const result = ok(resetFunctionToTemplate(sourceDir, ref, "matmul"));

    expect(result.mtimeMs).toBe(fs.statSync(file).mtimeMs);
    expect(result.mtimeMs).toBeGreaterThanOrEqual(before);
  });

  it("создаёт exercise.py из шаблона, если файла ещё нет", () => {
    const { sourceDir, file } = makeSource();

    const result = ok(resetFunctionToTemplate(sourceDir, ref, "matmul"));

    expect(result.code).toBe(TEMPLATE);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("отказывает, когда такой функции нет в шаблоне, и файл не трогает", () => {
    const { sourceDir, file } = makeSource(LEARNER);

    const result = resetFunctionToTemplate(sourceDir, ref, "shape");

    expect(result).toEqual({ error: "В заготовке упражнения нет функции shape" });
    expect(fs.readFileSync(file, "utf8")).toBe(LEARNER);
  });

  it("отказывает, когда у урока нет упражнения", () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-reset-empty-"));

    const result = resetFunctionToTemplate(sourceDir, ref, "matmul");

    expect(result).toEqual({ error: "У урока нет упражнения" });
  });

  it("отказывает, когда упражнение есть, а шаблона нет", () => {
    const { sourceDir } = makeSource(TEMPLATE);
    fs.rmSync(path.join(sourceDir, "learning-exercises", "p01-l02-beta", "exercise.template.py"));

    const result = resetFunctionToTemplate(sourceDir, ref, "matmul");

    expect(result).toEqual({ error: "У упражнения нет заготовки exercise.template.py" });
  });
});
