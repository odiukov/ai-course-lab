import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LessonRef } from "@/lib/source/catalog";
import {
  describeFunctions,
  exerciseMtimeMs,
  extractFunction,
  findExercise,
  readExerciseCodeBySlug,
  readExerciseFile,
  replaceFunction,
  writeExerciseCode,
  writeExerciseCodeIfUnchanged,
} from "./file";

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
  "    raise NotImplementedError",
  "",
].join("\n");

function makeSource(): { sourceDir: string; dir: string } {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-exercise-"));
  const dir = path.join(sourceDir, "learning-exercises", "p01-l02-beta");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "exercise.template.py"), TEMPLATE, "utf8");
  return { sourceDir, dir };
}

describe("findExercise", () => {
  it("находит каталог упражнения по номерам фазы и урока", () => {
    const { sourceDir } = makeSource();
    expect(findExercise(sourceDir, ref)).toEqual({
      slug: "p01-l02-beta",
      dir: path.join(sourceDir, "learning-exercises", "p01-l02-beta"),
    });
  });

  it("отдаёт null, когда упражнения у урока нет", () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-empty-"));
    expect(findExercise(sourceDir, ref)).toBeNull();
  });
});

describe("readExerciseFile", () => {
  it("создаёт exercise.py из шаблона при первом чтении", () => {
    const { sourceDir, dir } = makeSource();
    const file = readExerciseFile(sourceDir, ref)!;

    expect(file.createdFromTemplate).toBe(true);
    expect(fs.existsSync(path.join(dir, "exercise.py"))).toBe(true);
    expect(file.code).toBe(TEMPLATE);
    expect(file.relPath.endsWith("learning-exercises/p01-l02-beta/exercise.py")).toBe(true);
  });

  it("второе чтение уже ничего не копирует", () => {
    const { sourceDir } = makeSource();
    readExerciseFile(sourceDir, ref);
    expect(readExerciseFile(sourceDir, ref)!.createdFromTemplate).toBe(false);
  });

  it("описывает функции с границами и признаком «написана»", () => {
    const { sourceDir } = makeSource();
    const file = readExerciseFile(sourceDir, ref)!;
    expect(file.functions).toEqual([
      { fn: "transpose", signature: "transpose(M)", startLine: 4, endLine: 6, implemented: false },
      { fn: "matmul", signature: "matmul(A, B)", startLine: 9, endLine: 10, implemented: false },
    ]);
  });
});

describe("writeExerciseCode", () => {
  it("пишет код на диск и пересчитывает функции", () => {
    const { sourceDir, dir } = makeSource();
    readExerciseFile(sourceDir, ref);
    const solved = TEMPLATE.replace(
      "    raise NotImplementedError\n\n\ndef matmul",
      "    return [list(row) for row in zip(*M)]\n\n\ndef matmul",
    );

    const result = writeExerciseCode(sourceDir, ref, solved);
    expect(fs.readFileSync(path.join(dir, "exercise.py"), "utf8")).toBe(solved);
    expect(result.functions[0].implemented).toBe(true);
    expect(result.mtimeMs).toBeGreaterThan(0);
  });

  it("отказывается писать пустой файл", () => {
    const { sourceDir } = makeSource();
    readExerciseFile(sourceDir, ref);
    expect(() => writeExerciseCode(sourceDir, ref, "   \n")).toThrow(/пуст/i);
  });

  it("не оставляет после себя временного файла", () => {
    const { sourceDir, dir } = makeSource();
    readExerciseFile(sourceDir, ref);
    writeExerciseCode(sourceDir, ref, `${TEMPLATE}\n# ещё\n`);
    expect(fs.readdirSync(dir).filter((name) => name.includes(".tmp"))).toEqual([]);
  });
});

describe("writeExerciseCodeIfUnchanged", () => {
  function prepared() {
    const { sourceDir, dir } = makeSource();
    const file = readExerciseFile(sourceDir, ref)!;
    return { sourceDir, dir, file };
  }

  it("пишет, когда файл на диске тот же, что видел клиент", () => {
    const { sourceDir, dir, file } = prepared();
    const result = writeExerciseCodeIfUnchanged(sourceDir, ref, `${TEMPLATE}\n# правка\n`, file.mtimeMs);

    expect("conflict" in result).toBe(false);
    expect(fs.readFileSync(path.join(dir, "exercise.py"), "utf8")).toContain("# правка");
  });

  it("на изменившийся файл отдаёт расхождение с актуальным содержимым и не пишет", () => {
    const { sourceDir, dir, file } = prepared();
    const target = path.join(dir, "exercise.py");
    // Так выглядит вставка прошлого кода через POST /recall или правка из IDE,
    // приехавшая между набором текста и отложенным сохранением.
    const outside = `${TEMPLATE}\n# правка из IDE\n`;
    fs.writeFileSync(target, outside, "utf8");
    fs.utimesSync(target, new Date(), new Date(file.mtimeMs + 5000));

    const result = writeExerciseCodeIfUnchanged(sourceDir, ref, "# черновик из браузера\n", file.mtimeMs);

    expect("conflict" in result).toBe(true);
    if (!("conflict" in result)) throw new Error("ожидалось расхождение");
    expect(result.conflict.code).toBe(outside);
    expect(result.conflict.mtimeMs).not.toBe(file.mtimeMs);
    // Главное: черновик браузера НЕ затёр чужую правку.
    expect(fs.readFileSync(target, "utf8")).toBe(outside);
  });

  it("если файла нет вовсе, затирать нечего — пишет", () => {
    const { sourceDir, dir, file } = prepared();
    fs.rmSync(path.join(dir, "exercise.py"));
    const result = writeExerciseCodeIfUnchanged(sourceDir, ref, TEMPLATE, file.mtimeMs);
    expect("conflict" in result).toBe(false);
  });
});

// Slug приходит из адреса, поэтому путь обязан быть проверен, а не собран
// доверчиво: ../ в имени каталога упражнения не должен выводить за
// source/learning-exercises ни на чтении, ни на записи.
describe("защита от выхода за learning-exercises", () => {
  it("readExerciseCodeBySlug отказывается читать файл выше корня", () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-escape-"));
    fs.mkdirSync(path.join(sourceDir, "learning-exercises"), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "exercise.py"), "секрет\n", "utf8");

    expect(() => readExerciseCodeBySlug(sourceDir, "..")).toThrow(/вне source\/learning-exercises/);
    expect(() => readExerciseCodeBySlug(sourceDir, "../../etc")).toThrow(
      /вне source\/learning-exercises/,
    );
  });

  it("обычный slug проходит проверку", () => {
    const { sourceDir } = makeSource();
    readExerciseFile(sourceDir, ref);
    expect(readExerciseCodeBySlug(sourceDir, "p01-l02-beta")).toBe(TEMPLATE);
  });
});

describe("exerciseMtimeMs", () => {
  it("отдаёт то же время, что и readExerciseFile", () => {
    const { sourceDir } = makeSource();
    const file = readExerciseFile(sourceDir, ref)!;
    expect(exerciseMtimeMs(sourceDir, ref)).toBe(file.mtimeMs);
  });

  it("без упражнения — null", () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-empty-"));
    expect(exerciseMtimeMs(sourceDir, ref)).toBeNull();
  });
});

describe("extractFunction / replaceFunction", () => {
  it("вырезает одну функцию целиком", () => {
    expect(extractFunction(TEMPLATE, "transpose")).toBe(
      ['def transpose(M):', '    """Транспонирование."""', "    raise NotImplementedError"].join("\n"),
    );
  });

  it("на неизвестное имя отдаёт null", () => {
    expect(extractFunction(TEMPLATE, "nope")).toBeNull();
  });

  it("заменяет тело функции, не тронув соседей", () => {
    const replaced = replaceFunction(
      TEMPLATE,
      "transpose",
      "def transpose(M):\n    return [list(row) for row in zip(*M)]",
    );
    expect(replaced).toContain("return [list(row) for row in zip(*M)]");
    expect(replaced).toContain("def matmul(A, B):");
    expect(describeFunctions(replaced).map((item) => item.fn)).toEqual(["transpose", "matmul"]);
  });

  it("на неизвестное имя возвращает исходный код без изменений", () => {
    expect(replaceFunction(TEMPLATE, "nope", "def nope():\n    pass")).toBe(TEMPLATE);
  });
});
