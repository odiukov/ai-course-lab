import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LessonRef } from "@/lib/source/catalog";
import {
  canonicalFunctions,
  findExerciseTarget,
  findTreeFile,
  readExerciseTree,
  resolveExerciseFile,
} from "./tree";

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

function makeSingle(): string {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-tree-single-"));
  const dir = path.join(sourceDir, "learning-exercises", "p01-l02-beta");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "exercise.template.py"),
    "def transpose(M):\n    raise NotImplementedError\n",
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "test_exercise.py"), "", "utf8");
  return sourceDir;
}

function makeMulti(): string {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-tree-multi-"));
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

function addMethodManifest(sourceDir: string): void {
  const dir = path.join(sourceDir, "learning-exercises", "p19-l20-loop");
  fs.writeFileSync(
    path.join(dir, "exercise.template", "main.py"),
    [
      "class HarnessLoop:",
      "    def _transition(self, target):",
      "        raise NotImplementedError",
      "",
      "    def run(self, goal):",
      "        raise NotImplementedError",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "test_steps.py"), "", "utf8");
  fs.writeFileSync(
    path.join(dir, "exercise.json"),
    JSON.stringify({
      version: 1,
      targets: [
        {
          file: "main.py",
          symbol: "HarnessLoop._transition",
          tests: ["test_steps.py::test_transition"],
        },
        {
          file: "main.py",
          symbol: "HarnessLoop.run",
          tests: ["test_exercise.py"],
          bench: false,
        },
      ],
      requirements: ["torch", "numpy", "torch"],
      network: true,
    }),
    "utf8",
  );
}

describe("readExerciseTree", () => {
  it("читает одно-файловую форму как список из одного файла", () => {
    const tree = readExerciseTree(makeSingle(), ref);
    expect(tree?.multi).toBe(false);
    expect(tree?.files.map((file) => file.name)).toEqual(["exercise.py"]);
    expect(tree?.files[0].templatePath.endsWith("exercise.template.py")).toBe(true);
    expect(tree?.files[0].workPath.endsWith("exercise.py")).toBe(true);
  });

  it("читает каталожную форму, main.py первым, остальные по алфавиту", () => {
    const tree = readExerciseTree(makeMulti(), p19);
    expect(tree?.multi).toBe(true);
    expect(tree?.files.map((file) => file.name)).toEqual(["main.py", "events.py", "hooks.py"]);
  });

  it("находит эталон только у тех файлов, для которых он есть", () => {
    const tree = readExerciseTree(makeMulti(), p19)!;
    expect(findTreeFile(tree, "main.py")?.solutionPath).not.toBeNull();
    expect(findTreeFile(tree, "hooks.py")?.solutionPath).toBeNull();
  });

  it("отдаёт канонический состав парами файл+функция", () => {
    const tree = readExerciseTree(makeMulti(), p19)!;
    expect(canonicalFunctions(tree)).toEqual([
      { file: "main.py", fn: "run" },
      { file: "events.py", fn: "emit" },
      { file: "hooks.py", fn: "fire" },
    ]);
  });

  it("возвращает null, когда упражнения у урока нет", () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-tree-none-"));
    expect(readExerciseTree(sourceDir, ref)).toBeNull();
  });

  it("манифест задаёт квалифицированные цели и точные тесты", () => {
    const sourceDir = makeMulti();
    addMethodManifest(sourceDir);
    const tree = readExerciseTree(sourceDir, p19)!;

    expect(canonicalFunctions(tree)).toEqual([
      { file: "main.py", fn: "HarnessLoop._transition" },
      { file: "main.py", fn: "HarnessLoop.run" },
    ]);
    expect(tree.testPaths.map((file) => path.basename(file))).toEqual([
      "test_exercise.py",
      "test_steps.py",
    ]);
    expect(tree.requirements).toEqual(["numpy", "torch"]);
    expect(tree.network).toBe(true);
    expect(findExerciseTarget(tree, "main.py", "HarnessLoop._transition")).toEqual({
      file: "main.py",
      fn: "HarnessLoop._transition",
      tests: ["test_steps.py::test_transition"],
      bench: false,
    });
  });

  it("отклоняет цель манифеста, которой нет в шаблоне", () => {
    const sourceDir = makeMulti();
    addMethodManifest(sourceDir);
    const manifest = path.join(
      sourceDir,
      "learning-exercises",
      "p19-l20-loop",
      "exercise.json",
    );
    const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
    parsed.targets[0].symbol = "HarnessLoop.missing";
    fs.writeFileSync(manifest, JSON.stringify(parsed), "utf8");

    expect(() => readExerciseTree(sourceDir, p19)).toThrow(
      "В шаблоне main.py нет цели HarnessLoop.missing",
    );
  });
});

describe("duplicateFunctions", () => {
  it("перечисляет имена, встречающиеся больше чем в одном файле", () => {
    const sourceDir = makeMulti();
    const template = path.join(
      sourceDir, "learning-exercises", "p19-l20-loop", "exercise.template",
    );
    fs.writeFileSync(
      path.join(template, "hooks.py"),
      "def run(goal):\n    raise NotImplementedError\n",
      "utf8",
    );
    expect(readExerciseTree(sourceDir, p19)?.duplicateFunctions).toEqual(["run"]);
  });

  it("пустой список, когда все имена уникальны", () => {
    expect(readExerciseTree(makeMulti(), p19)?.duplicateFunctions).toEqual([]);
  });
});

describe("findTreeFile", () => {
  it("не отдаёт файл, которого нет в шаблоне", () => {
    const tree = readExerciseTree(makeMulti(), p19)!;
    expect(findTreeFile(tree, "secrets.py")).toBeNull();
    expect(findTreeFile(tree, "../../etc/passwd")).toBeNull();
  });
});

describe("resolveExerciseFile", () => {
  it("объявленный файл побеждает всегда, даже когда имя не совпадает ни с одним владельцем", () => {
    const tree = readExerciseTree(makeMulti(), p19)!;
    expect(resolveExerciseFile(tree, "run", "hooks.py")).toBe("hooks.py");
  });

  it("одно-файловая форма — всегда exercise.py, объявление не нужно", () => {
    const tree = readExerciseTree(makeSingle(), ref)!;
    expect(resolveExerciseFile(tree, "transpose")).toBe("exercise.py");
  });

  it("каталожная форма без объявления — файл, где функция единственная", () => {
    const tree = readExerciseTree(makeMulti(), p19)!;
    expect(resolveExerciseFile(tree, "fire")).toBe("hooks.py");
    expect(resolveExerciseFile(tree, "emit")).toBe("events.py");
  });

  it("разрешает файл квалифицированного метода из манифеста", () => {
    const sourceDir = makeMulti();
    addMethodManifest(sourceDir);
    const tree = readExerciseTree(sourceDir, p19)!;
    expect(resolveExerciseFile(tree, "HarnessLoop._transition")).toBe("main.py");
  });

  it("дубль без объявления — первый файл по порядку шаблона, а не ошибка", () => {
    const sourceDir = makeMulti();
    const template = path.join(
      sourceDir, "learning-exercises", "p19-l20-loop", "exercise.template",
    );
    // run уже есть в main.py — делаем его дублем и в hooks.py.
    fs.writeFileSync(
      path.join(template, "hooks.py"),
      "def run(goal):\n    raise NotImplementedError\n",
      "utf8",
    );
    const tree = readExerciseTree(sourceDir, p19)!;
    expect(tree.duplicateFunctions).toEqual(["run"]);
    // main.py — первый по порядку (см. orderNames), поэтому он и побеждает
    // как разумный дефолт: до этого места дойти не должно (plan-lesson
    // обязан был потребовать exercise_file на дубле), но упасть тут хуже,
    // чем вернуть хоть какой-то файл.
    expect(resolveExerciseFile(tree, "run")).toBe("main.py");
  });
});
