import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LessonRef } from "@/lib/source/catalog";
import {
  describeFunctions,
  exerciseFileMtimeMs,
  extractFunction,
  findExercise,
  readCanonicalFunctionNames,
  readExerciseCodeBySlug,
  readExerciseFiles,
  replaceFunction,
  writeExerciseFile,
  writeExerciseFileIfUnchanged,
} from "./file";

const ref: LessonRef = {
  slug: "01-math__02-beta",
  phaseDir: "01-math",
  lessonDir: "02-beta",
  phaseNumber: 1,
  lessonNumber: 2,
  title: "Beta",
};

const p19: LessonRef = {
  slug: "19-capstone-projects__20-loop",
  phaseDir: "19-capstone-projects",
  lessonDir: "20-loop",
  phaseNumber: 19,
  lessonNumber: 20,
  title: "Loop",
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

// Копия фикстуры из tree.test.ts, повторена намеренно: тестовые файлы не
// должны зависеть друг от друга.
function makeMulti(): string {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-file-multi-"));
  const dir = path.join(sourceDir, "learning-exercises", "p19-l20-loop");
  fs.mkdirSync(path.join(dir, "exercise.template"), { recursive: true });
  fs.mkdirSync(path.join(dir, "solution"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "exercise.template", "hooks.py"),
    "def fire(topic):\n    raise NotImplementedError\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "exercise.template", "main.py"),
    "def run(goal):\n    raise NotImplementedError\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "exercise.template", "events.py"),
    "def emit(event):\n    raise NotImplementedError\n",
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "solution", "main.py"), "def run(goal):\n    return 1\n", "utf8");
  fs.writeFileSync(path.join(dir, "test_exercise.py"), "", "utf8");
  return sourceDir;
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

describe("readExerciseFiles — одно-файловая форма", () => {
  it("создаёт exercise.py из шаблона при первом чтении", () => {
    const { sourceDir, dir } = makeSource();
    const file = readExerciseFiles(sourceDir, ref)!.files[0];

    expect(file.createdFromTemplate).toBe(true);
    expect(fs.existsSync(path.join(dir, "exercise.py"))).toBe(true);
    expect(file.code).toBe(TEMPLATE);
    expect(file.relPath.endsWith("learning-exercises/p01-l02-beta/exercise.py")).toBe(true);
  });

  it("второе чтение уже ничего не копирует", () => {
    const { sourceDir } = makeSource();
    readExerciseFiles(sourceDir, ref);
    expect(readExerciseFiles(sourceDir, ref)!.files[0].createdFromTemplate).toBe(false);
  });

  it("описывает функции с границами и признаком «написана»", () => {
    const { sourceDir } = makeSource();
    const file = readExerciseFiles(sourceDir, ref)!.files[0];
    expect(file.functions).toEqual([
      { fn: "transpose", signature: "transpose(M)", startLine: 4, endLine: 6, implemented: false },
      { fn: "matmul", signature: "matmul(A, B)", startLine: 9, endLine: 10, implemented: false },
    ]);
  });
});

describe("readExerciseFiles", () => {
  it("разворачивает каталожный шаблон в exercise/ при первом чтении", () => {
    const sourceDir = makeMulti();
    const set = readExerciseFiles(sourceDir, p19)!;
    expect(set.multi).toBe(true);
    expect(set.files.map((file) => file.name)).toEqual(["main.py", "events.py", "hooks.py"]);
    expect(set.files.every((file) => file.createdFromTemplate)).toBe(true);
    const onDisk = path.join(sourceDir, "learning-exercises", "p19-l20-loop", "exercise", "main.py");
    expect(fs.existsSync(onDisk)).toBe(true);
  });

  it("второе чтение не перезаписывает файлы человека", () => {
    const sourceDir = makeMulti();
    readExerciseFiles(sourceDir, p19);
    const file = path.join(sourceDir, "learning-exercises", "p19-l20-loop", "exercise", "main.py");
    fs.writeFileSync(file, "def run(goal):\n    return 42\n", "utf8");
    const set = readExerciseFiles(sourceDir, p19)!;
    const main = set.files.find((item) => item.name === "main.py")!;
    expect(main.code).toContain("return 42");
    expect(main.createdFromTemplate).toBe(false);
  });

  it("одно-файловое упражнение отдаётся списком из одного файла", () => {
    const set = readExerciseFiles(makeSource().sourceDir, ref)!;
    expect(set.multi).toBe(false);
    expect(set.files).toHaveLength(1);
    expect(set.files[0].name).toBe("exercise.py");
  });
});

describe("readCanonicalFunctionNames — одно-файловая форма", () => {
  it("берёт состав из шаблона, а не из файла учащегося", () => {
    const { sourceDir, dir } = makeSource();
    readExerciseFiles(sourceDir, ref);
    // Учащийся дописал себе вспомогательную функцию: в каноническом составе
    // упражнения её быть не должно.
    fs.writeFileSync(
      path.join(dir, "exercise.py"),
      `${TEMPLATE}\n\ndef shape(M):\n    return len(M), len(M[0])\n`,
      "utf8",
    );

    expect(readCanonicalFunctionNames(sourceDir, ref)).toEqual(["transpose", "matmul"]);
    // Для сравнения: живой файл дал бы лишнее имя — то самое, что попадало в
    // отрицание фильтра -k.
    expect(describeFunctions(fs.readFileSync(path.join(dir, "exercise.py"), "utf8")).map((f) => f.fn))
      .toEqual(["transpose", "matmul", "shape"]);
  });

  it("без упражнения — пустой список, а не имена из чужого файла", () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-empty-"));
    expect(readCanonicalFunctionNames(sourceDir, ref)).toEqual([]);
  });
});

describe("readCanonicalFunctionNames", () => {
  it("собирает имена по всем файлам упражнения", () => {
    expect(readCanonicalFunctionNames(makeMulti(), p19)).toEqual(["run", "emit", "fire"]);
  });
});

describe("writeExerciseFile — одно-файловая форма", () => {
  it("пишет код на диск и пересчитывает функции", () => {
    const { sourceDir, dir } = makeSource();
    readExerciseFiles(sourceDir, ref);
    const solved = TEMPLATE.replace(
      "    raise NotImplementedError\n\n\ndef matmul",
      "    return [list(row) for row in zip(*M)]\n\n\ndef matmul",
    );

    const result = writeExerciseFile(sourceDir, ref, "exercise.py", solved);
    expect(fs.readFileSync(path.join(dir, "exercise.py"), "utf8")).toBe(solved);
    expect(result.name).toBe("exercise.py");
    expect(result.functions[0].implemented).toBe(true);
    expect(result.mtimeMs).toBeGreaterThan(0);
  });

  it("отказывается писать пустой файл", () => {
    const { sourceDir } = makeSource();
    readExerciseFiles(sourceDir, ref);
    expect(() => writeExerciseFile(sourceDir, ref, "exercise.py", "   \n")).toThrow(/пуст/i);
  });

  it("не оставляет после себя временного файла", () => {
    const { sourceDir, dir } = makeSource();
    readExerciseFiles(sourceDir, ref);
    writeExerciseFile(sourceDir, ref, "exercise.py", `${TEMPLATE}\n# ещё\n`);
    expect(fs.readdirSync(dir).filter((name) => name.includes(".tmp"))).toEqual([]);
  });
});

describe("writeExerciseFileIfUnchanged — одно-файловая форма", () => {
  function prepared() {
    const { sourceDir, dir } = makeSource();
    const file = readExerciseFiles(sourceDir, ref)!.files[0];
    return { sourceDir, dir, file };
  }

  it("пишет, когда файл на диске тот же, что видел клиент", () => {
    const { sourceDir, dir, file } = prepared();
    const result = writeExerciseFileIfUnchanged(
      sourceDir, ref, "exercise.py", `${TEMPLATE}\n# правка\n`, file.mtimeMs,
    );

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

    const result = writeExerciseFileIfUnchanged(
      sourceDir, ref, "exercise.py", "# черновик из браузера\n", file.mtimeMs,
    );

    expect("conflict" in result).toBe(true);
    if (!("conflict" in result)) throw new Error("ожидалось расхождение");
    expect(result.conflict.code).toBe(outside);
    expect(result.conflict.mtimeMs).not.toBe(file.mtimeMs);
    // Главное: черновик браузера НЕ затёр чужую правку.
    expect(fs.readFileSync(target, "utf8")).toBe(outside);
  });

  // Метки времени на APFS наносекундные, и три записи подряд укладываются в
  // одну и ту же округлённую миллисекунду. Пока mtimeMs округлялся, такие
  // записи сравнивались как равные, и отложенный PUT проходил предусловие,
  // хотя файл на диске уже был другим.
  it("доли миллисекунды не теряются: округлённый mtime — это расхождение", () => {
    const { sourceDir, dir, file } = prepared();
    const target = path.join(dir, "exercise.py");
    const seconds = Math.floor(Date.now() / 1000);
    fs.utimesSync(target, seconds, seconds + 0.0004);

    const exact = exerciseFileMtimeMs(sourceDir, ref, "exercise.py")!;
    expect(exact).not.toBe(Math.round(exact));
    expect(exact).toBe(seconds * 1000 + 0.4);

    const stale = writeExerciseFileIfUnchanged(
      sourceDir, ref, "exercise.py", "# черновик\n", Math.round(exact),
    );
    expect("conflict" in stale).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe(file.code);

    // А с точным значением та же запись проходит.
    const fresh = writeExerciseFileIfUnchanged(sourceDir, ref, "exercise.py", "# черновик\n", exact);
    expect("conflict" in fresh).toBe(false);
  });

  it("если файла нет вовсе, затирать нечего — пишет", () => {
    const { sourceDir, dir, file } = prepared();
    fs.rmSync(path.join(dir, "exercise.py"));
    const result = writeExerciseFileIfUnchanged(sourceDir, ref, "exercise.py", TEMPLATE, file.mtimeMs);
    expect("conflict" in result).toBe(false);
  });
});

describe("writeExerciseFileIfUnchanged", () => {
  it("пишет в указанный файл каталожной формы", () => {
    const sourceDir = makeMulti();
    const set = readExerciseFiles(sourceDir, p19)!;
    const main = set.files.find((item) => item.name === "main.py")!;
    const result = writeExerciseFileIfUnchanged(
      sourceDir, p19, "main.py", "def run(goal):\n    return 7\n", main.mtimeMs,
    );
    expect("conflict" in result).toBe(false);
    expect(fs.readFileSync(main.file, "utf8")).toContain("return 7");
  });

  it("отвечает расхождением, когда файл изменился мимо редактора", () => {
    const sourceDir = makeMulti();
    const set = readExerciseFiles(sourceDir, p19)!;
    const main = set.files.find((item) => item.name === "main.py")!;
    fs.writeFileSync(main.file, "def run(goal):\n    return 1\n", "utf8");
    const result = writeExerciseFileIfUnchanged(
      sourceDir, p19, "main.py", "def run(goal):\n    return 2\n", main.mtimeMs - 1,
    );
    expect("conflict" in result).toBe(true);
  });

  it("отказывает в записи файла, которого нет в шаблоне", () => {
    const sourceDir = makeMulti();
    readExerciseFiles(sourceDir, p19);
    expect(() =>
      writeExerciseFileIfUnchanged(sourceDir, p19, "evil.py", "x = 1\n", 0),
    ).toThrow(/нет файла evil\.py/);
  });

  it("отказывает в записи по пути с выходом из каталога", () => {
    const sourceDir = makeMulti();
    readExerciseFiles(sourceDir, p19);
    expect(() =>
      writeExerciseFileIfUnchanged(sourceDir, p19, "../solution/main.py", "x = 1\n", 0),
    ).toThrow();
  });
});

// Slug приходит из адреса, поэтому путь обязан быть проверен, а не собран
// доверчиво: ../ в имени каталога упражнения не должен выводить за
// source/learning-exercises ни на чтении, ни на записи.
describe("защита от выхода за learning-exercises", () => {
  it("readExerciseCodeBySlug молча отказывается читать файл выше корня", () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-escape-"));
    fs.mkdirSync(path.join(sourceDir, "learning-exercises"), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "exercise.py"), "секрет\n", "utf8");

    // slug — не сообщение об ошибке, а внутренний ключ из readWrittenFunctions:
    // выходящий за корень кандидат просто пропускается, как если бы файла не было.
    expect(readExerciseCodeBySlug(sourceDir, "..")).toBeNull();
    expect(readExerciseCodeBySlug(sourceDir, "../../etc")).toBeNull();
  });

  it("обычный slug проходит проверку", () => {
    const { sourceDir } = makeSource();
    readExerciseFiles(sourceDir, ref);
    expect(readExerciseCodeBySlug(sourceDir, "p01-l02-beta")).toBe(TEMPLATE);
  });
});

describe("exerciseFileMtimeMs", () => {
  it("отдаёт то же время, что и readExerciseFiles", () => {
    const { sourceDir } = makeSource();
    const file = readExerciseFiles(sourceDir, ref)!.files[0];
    expect(exerciseFileMtimeMs(sourceDir, ref, "exercise.py")).toBe(file.mtimeMs);
  });

  it("без упражнения — null", () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-empty-"));
    expect(exerciseFileMtimeMs(sourceDir, ref, "exercise.py")).toBeNull();
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
