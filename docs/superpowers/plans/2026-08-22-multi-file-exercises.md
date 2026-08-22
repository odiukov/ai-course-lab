# Многофайловое упражнение — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** упражнение урока может состоять из нескольких `.py`-файлов; редактор показывает их табами, тесты, сброс, recall и замер работают по файлу.

**Architecture:** рядом с существующей одно-файловой формой (`exercise.template.py` → `exercise.py`) появляется каталожная (`exercise.template/` → `exercise/`). Форму определяет один новый модуль `src/lib/exercise/tree.ts`; всё остальное (чтение, запись, тесты, сброс, recall, замер, панель практики) работает со списком файлов, где у старой формы список из одного элемента. Существующие 382 упражнения и их `lesson.json` не меняются.

**Tech Stack:** TypeScript, Next.js 16.3.0 (App Router), React 19.2.8, Monaco, vitest, `node:sqlite`, Python 3 + pytest, zod.

**Spec:** `docs/superpowers/specs/2026-08-22-phase-19-project-catalog-design.md` (раздел «Редактор, раннер, проверки среды»)

## Global Constraints

- Комментарии и сообщения об ошибках — по-русски, как во всём проекте. Комментарий объясняет «почему», а не «что»; на неочевидное решение — ссылка на конкретный случай, который его вызвал.
- Тесты лежат рядом с кодом: `foo.ts` → `foo.test.ts`. Прогон: `npm test` (vitest run).
- Перед коммитом проходят `npm test`, `npm run lint`, `npm run typecheck`.
- Одно-файловая форма упражнения остаётся рабочей без изменений на диске. Ни одно из 382 существующих упражнений не переносится.
- `exercise_fn` в `lesson.json` остаётся строкой; файл указывается отдельным необязательным полем `exercise_file`. Это и есть «пара файл + функция» из спеки в форме, которая не ломает 382 готовых плана.
- Человек не создаёт файлы в упражнении: шаблон везёт все файлы, включая пустые с докстрокой. Запись разрешена только в файлы, имена которых есть в шаблоне, и только с расширением `.py`.
- Порядок файлов в упражнении детерминированный: `main.py` первым, остальные по алфавиту. От него зависит порядок табов, и «как получилось из readdir» здесь недопустимо.
- Никаких внешних CDN и сетевых зависимостей в рантайме приложения.

## File Structure

**Создаются:**
- `src/lib/exercise/tree.ts` — определение формы упражнения и списка его файлов. Единственное место, которое знает про `exercise.template.py` против `exercise.template/`.
- `src/lib/exercise/tree.test.ts`

**Изменяются:**
- `src/lib/exercise/file.ts` — чтение и запись по имени файла вместо жёсткого `exercise.py`.
- `src/lib/exercise/reset.ts` — сброс функции в файле.
- `src/lib/exercise/recall.ts` — поиск и вставка прошлой реализации с учётом файла.
- `src/lib/source/written-functions.ts` — `readWrittenFunctions` обходит и каталожную форму.
- `src/lib/source/lesson-source.ts` — `ExerciseInfo.functions` становится списком пар.
- `src/lib/content/step-file.ts` — поле `exercise_file`.
- `src/lib/content/lesson-plan.ts` — `validatePlan` проверяет пару и требует `exercise_file` при неоднозначном имени.
- `src/lib/practice/run-tests.ts` — `PYTHONPATH` для каталожной формы, отказ от `-k` при дублирующемся имени функции.
- `src/lib/practice/bench.ts` + `scripts/bench.py` — замер конкретного модуля упражнения.
- `src/app/api/lesson/[slug]/exercise/route.ts` — массив файлов в GET, поле `file` в PUT.
- `src/app/api/lesson/[slug]/tests/route.ts`, `.../recall/route.ts`, `.../exercise/reset/route.ts` — прокидывание файла.
- `src/components/ExercisePanel.tsx` — табы и состояние на файл.
- `src/app/lesson/[slug]/reader.tsx` — передача `exercise_file` в панель и в карточку recall.
- `src/lib/site/exercise.ts`, `scripts/build-site.mts` — каталожная форма в статической сборке.

---

### Task 1: Модуль формы упражнения (`tree.ts`)

**Files:**
- Create: `src/lib/exercise/tree.ts`
- Test: `src/lib/exercise/tree.test.ts`

**Interfaces:**
- Consumes: `findExerciseDir` из `src/lib/source/naming.ts`, `parseTopLevelFunctions` из `src/lib/source/written-functions.ts`, тип `LessonRef` из `src/lib/source/catalog.ts`.
- Produces:
  ```ts
  export interface ExerciseFileRef {
    name: string;              // "exercise.py" | "main.py" | "hooks.py"
    templatePath: string;
    workPath: string;
    solutionPath: string | null;
  }
  export interface ExerciseTree {
    slug: string;
    dir: string;
    multi: boolean;
    files: ExerciseFileRef[];
    testPath: string | null;
    duplicateFunctions: string[];
  }
  export function readExerciseTree(sourceDir: string, ref: LessonRef): ExerciseTree | null;
  export function findTreeFile(tree: ExerciseTree, name: string): ExerciseFileRef | null;
  export function canonicalFunctions(tree: ExerciseTree): { file: string; fn: string }[];
  ```

- [ ] **Step 1: Написать падающий тест на обе формы**

```ts
// src/lib/exercise/tree.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LessonRef } from "@/lib/source/catalog";
import { canonicalFunctions, findTreeFile, readExerciseTree } from "./tree";

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
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/lib/exercise/tree.test.ts`
Expected: FAIL — `Failed to resolve import "./tree"`.

- [ ] **Step 3: Написать модуль**

```ts
// src/lib/exercise/tree.ts
import fs from "node:fs";
import path from "node:path";
import type { LessonRef } from "../source/catalog";
import { findExerciseDir } from "../source/naming";
import { parseTopLevelFunctions } from "../source/written-functions";

export interface ExerciseFileRef {
  /** Имя файла внутри упражнения. У старой формы — всегда `exercise.py`. */
  name: string;
  templatePath: string;
  /** Файл, который правит человек. */
  workPath: string;
  solutionPath: string | null;
}

export interface ExerciseTree {
  slug: string;
  dir: string;
  /** Каталожная форма (`exercise.template/`) против одно-файловой. */
  multi: boolean;
  files: ExerciseFileRef[];
  testPath: string | null;
  /**
   * Имена функций, встречающиеся больше чем в одном файле упражнения.
   *
   * Нужны не для красоты: фильтр `pytest -k` сравнивает подстроку с именем
   * теста и про файлы ничего не знает. Совпавшее имя означает, что отбор
   * тестов шага собрал бы чужие тесты, и лучше прогнать файл целиком с
   * предупреждением, чем покрасить шаг за соседний модуль.
   */
  duplicateFunctions: string[];
}

const SAFE_NAME = /^[A-Za-z0-9_-]+\.py$/;

/**
 * Порядок файлов упражнения: `main.py` первым, остальные по алфавиту.
 *
 * Порядок readdir зависит от файловой системы, а от этого порядка зависят
 * табы редактора и то, какой файл откроется первым. «Как отдал диск» здесь
 * означало бы, что на другой машине упражнение открывается с другого файла.
 */
function orderNames(names: string[]): string[] {
  const rest = names.filter((name) => name !== "main.py").sort();
  return names.includes("main.py") ? ["main.py", ...rest] : rest;
}

export function readExerciseTree(sourceDir: string, ref: LessonRef): ExerciseTree | null {
  const root = path.join(sourceDir, "learning-exercises");
  const slug = findExerciseDir(root, ref);
  if (!slug) return null;

  const dir = path.join(root, slug);
  const testPathCandidate = path.join(dir, "test_exercise.py");
  const testPath = fs.existsSync(testPathCandidate) ? testPathCandidate : null;

  const templateDir = path.join(dir, "exercise.template");
  const multi = fs.existsSync(templateDir) && fs.statSync(templateDir).isDirectory();

  const files: ExerciseFileRef[] = [];
  if (multi) {
    const names = orderNames(
      fs.readdirSync(templateDir).filter((name) => SAFE_NAME.test(name)),
    );
    for (const name of names) {
      const solution = path.join(dir, "solution", name);
      files.push({
        name,
        templatePath: path.join(templateDir, name),
        workPath: path.join(dir, "exercise", name),
        solutionPath: fs.existsSync(solution) ? solution : null,
      });
    }
  } else {
    const template = path.join(dir, "exercise.template.py");
    if (!fs.existsSync(template)) return null;
    const solution = path.join(dir, "solution.py");
    files.push({
      name: "exercise.py",
      templatePath: template,
      workPath: path.join(dir, "exercise.py"),
      solutionPath: fs.existsSync(solution) ? solution : null,
    });
  }

  if (files.length === 0) return null;

  return { slug, dir, multi, files, testPath, duplicateFunctions: duplicates(files) };
}

function duplicates(files: ExerciseFileRef[]): string[] {
  const seen = new Map<string, number>();
  for (const file of files) {
    if (!fs.existsSync(file.templatePath)) continue;
    const source = fs.readFileSync(file.templatePath, "utf8");
    for (const block of parseTopLevelFunctions(source)) {
      seen.set(block.fn, (seen.get(block.fn) ?? 0) + 1);
    }
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([fn]) => fn).sort();
}

/**
 * Файл упражнения по имени — и `null` на всё, чего в шаблоне нет.
 *
 * Имя приходит из запроса, а из него собирается путь записи. Проверка формы
 * (`SAFE_NAME`) здесь не помогла бы одна: `main.py` из чужого упражнения тоже
 * проходит форму. Правда — состав шаблона, поэтому сверка идёт со списком.
 */
export function findTreeFile(tree: ExerciseTree, name: string): ExerciseFileRef | null {
  return tree.files.find((file) => file.name === name) ?? null;
}

/** Канонический состав упражнения — из шаблона, а не из файла человека. */
export function canonicalFunctions(tree: ExerciseTree): { file: string; fn: string }[] {
  const pairs: { file: string; fn: string }[] = [];
  for (const file of tree.files) {
    if (!fs.existsSync(file.templatePath)) continue;
    for (const block of parseTopLevelFunctions(fs.readFileSync(file.templatePath, "utf8"))) {
      pairs.push({ file: file.name, fn: block.fn });
    }
  }
  return pairs;
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run src/lib/exercise/tree.test.ts`
Expected: PASS, 8 тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/exercise/tree.ts src/lib/exercise/tree.test.ts
git commit -m "feat(exercise): read an exercise as a list of files, single or many"
```

---

### Task 2: Чтение и запись упражнения по файлу

**Files:**
- Modify: `src/lib/exercise/file.ts`
- Test: `src/lib/exercise/file.test.ts`

**Interfaces:**
- Consumes: `readExerciseTree`, `findTreeFile`, `canonicalFunctions` (Task 1).
- Produces:
  ```ts
  export interface ExerciseFileState {
    name: string;
    file: string;
    relPath: string;
    code: string;
    mtimeMs: number;
    functions: ExerciseFunction[];
    createdFromTemplate: boolean;
  }
  export interface ExerciseFileSet {
    exerciseSlug: string;
    dir: string;
    multi: boolean;
    files: ExerciseFileState[];
  }
  export function readExerciseFiles(sourceDir: string, ref: LessonRef): ExerciseFileSet | null;
  export function exerciseFileMtimeMs(sourceDir: string, ref: LessonRef, name: string): number | null;
  export function writeExerciseFile(sourceDir: string, ref: LessonRef, name: string, code: string): ExerciseWrite;
  export function writeExerciseFileIfUnchanged(sourceDir: string, ref: LessonRef, name: string, code: string, expectedMtimeMs: number): ExerciseWrite | ExerciseConflict;
  export function readCanonicalFunctionNames(sourceDir: string, ref: LessonRef): string[];
  ```
  `ExerciseWrite` получает поле `name`. `readExerciseFile`, `writeExerciseCode`, `writeExerciseCodeIfUnchanged`, `exerciseMtimeMs` удаляются — их заменяют функции выше. `readExerciseCodeBySlug(sourceDir, exerciseSlug, name = "exercise.py")` получает третий аргумент.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `src/lib/exercise/file.test.ts` (фикстура `makeMulti` — копия из Task 1, повторена намеренно: тестовые файлы не должны зависеть друг от друга):

```ts
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

describe("readCanonicalFunctionNames", () => {
  it("собирает имена по всем файлам упражнения", () => {
    expect(readCanonicalFunctionNames(makeMulti(), p19)).toEqual(["run", "emit", "fire"]);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/lib/exercise/file.test.ts`
Expected: FAIL — `readExerciseFiles is not exported`.

- [ ] **Step 3: Переписать `file.ts` на список файлов**

Заменить `exerciseFilePath`, `readExerciseFile`, `exerciseMtimeMs`, `writeExerciseCode`, `writeExerciseCodeIfUnchanged`, `readCanonicalFunctions` на:

```ts
import { canonicalFunctions, findTreeFile, readExerciseTree, type ExerciseTree } from "./tree";

export interface ExerciseFileState {
  name: string;
  file: string;
  relPath: string;
  code: string;
  mtimeMs: number;
  functions: ExerciseFunction[];
  createdFromTemplate: boolean;
}

export interface ExerciseFileSet {
  exerciseSlug: string;
  dir: string;
  multi: boolean;
  files: ExerciseFileState[];
}

// Единственная точка, которая собирает путь файла человека — и для чтения, и
// для записи. Две проверки вместо доверия: имя обязано быть в шаблоне (его
// присылает клиент), и собранный путь обязан лежать внутри каталога
// упражнения (`main.py` из чужого упражнения проходит первую проверку, но не
// вторую).
function workFilePath(sourceDir: string, tree: ExerciseTree, name: string): string {
  const ref = findTreeFile(tree, name);
  if (!ref) throw new Error(`В упражнении ${tree.slug} нет файла ${name}`);
  const root = path.resolve(sourceDir, "learning-exercises");
  const file = path.resolve(ref.workPath);
  if (!file.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Путь упражнения вне source/learning-exercises: ${file}`);
  }
  return file;
}

function readOne(sourceDir: string, tree: ExerciseTree, name: string): ExerciseFileState | null {
  const file = workFilePath(sourceDir, tree, name);
  const template = findTreeFile(tree, name)!.templatePath;
  let createdFromTemplate = false;
  if (!fs.existsSync(file)) {
    if (!fs.existsSync(template)) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(template, file);
    createdFromTemplate = true;
  }
  const code = fs.readFileSync(file, "utf8");
  return {
    name,
    file,
    relPath: repoRelative(file),
    code,
    // Без округления: mtimeMs — предусловие записи, и округление до
    // миллисекунды делало бы две записи в один тик неразличимыми.
    mtimeMs: fs.statSync(file).mtimeMs,
    functions: describeFunctions(code),
    createdFromTemplate,
  };
}

export function readExerciseFiles(sourceDir: string, ref: LessonRef): ExerciseFileSet | null {
  const tree = readExerciseTree(sourceDir, ref);
  if (!tree) return null;
  const files: ExerciseFileState[] = [];
  for (const item of tree.files) {
    const state = readOne(sourceDir, tree, item.name);
    if (state) files.push(state);
  }
  if (files.length === 0) return null;
  return { exerciseSlug: tree.slug, dir: tree.dir, multi: tree.multi, files };
}

export function exerciseFileMtimeMs(
  sourceDir: string,
  ref: LessonRef,
  name: string,
): number | null {
  const tree = readExerciseTree(sourceDir, ref);
  if (!tree || !findTreeFile(tree, name)) return null;
  const file = workFilePath(sourceDir, tree, name);
  return fs.existsSync(file) ? fs.statSync(file).mtimeMs : null;
}

export interface ExerciseWrite {
  name: string;
  mtimeMs: number;
  functions: ExerciseFunction[];
}

export interface ExerciseConflict {
  conflict: { name: string; code: string; mtimeMs: number; functions: ExerciseFunction[] };
}

export function writeExerciseFile(
  sourceDir: string,
  ref: LessonRef,
  name: string,
  code: string,
): ExerciseWrite {
  const tree = readExerciseTree(sourceDir, ref);
  if (!tree) throw new Error(`У урока ${ref.slug} нет упражнения`);
  if (code.trim().length === 0) {
    // Пустое тело запроса и потерянное соединение для сервера выглядят
    // одинаково, а результат был бы разный: стёртый файл с решением.
    throw new Error("Код упражнения пуст — запись отклонена");
  }
  const file = workFilePath(sourceDir, tree, name);
  writeAtomically(file, code);
  return { name, mtimeMs: fs.statSync(file).mtimeMs, functions: describeFunctions(code) };
}

export function writeExerciseFileIfUnchanged(
  sourceDir: string,
  ref: LessonRef,
  name: string,
  code: string,
  expectedMtimeMs: number,
): ExerciseWrite | ExerciseConflict {
  const tree = readExerciseTree(sourceDir, ref);
  if (!tree) throw new Error(`У урока ${ref.slug} нет упражнения`);
  const file = workFilePath(sourceDir, tree, name);
  if (fs.existsSync(file)) {
    const actual = fs.statSync(file).mtimeMs;
    if (actual !== expectedMtimeMs) {
      const current = fs.readFileSync(file, "utf8");
      return {
        conflict: { name, code: current, mtimeMs: actual, functions: describeFunctions(current) },
      };
    }
  }
  return writeExerciseFile(sourceDir, ref, name, code);
}

/**
 * Канонические имена функций всего упражнения — по всем файлам.
 *
 * Плоский список имён, а не пар: он идёт в отрицание фильтра `pytest -k`, а
 * `-k` про файлы ничего не знает. Пары нужны валидатору плана, он берёт их из
 * canonicalFunctions(tree).
 */
export function readCanonicalFunctionNames(sourceDir: string, ref: LessonRef): string[] {
  const tree = readExerciseTree(sourceDir, ref);
  if (!tree) return [];
  return canonicalFunctions(tree).map((pair) => pair.fn);
}
```

`readExerciseCodeBySlug` получает имя файла:

```ts
export function readExerciseCodeBySlug(
  sourceDir: string,
  exerciseSlug: string,
  name = "exercise.py",
): string | null {
  const root = path.resolve(sourceDir, "learning-exercises");
  const dir = path.join(root, exerciseSlug);
  // Каталожная форма держит файлы человека в exercise/, старая — в корне
  // каталога упражнения. Обе проверяются, потому что recall ищет по всему
  // курсу, где сейчас лежат обе.
  for (const candidate of [path.join(dir, name), path.join(dir, "exercise", name)]) {
    const file = path.resolve(candidate);
    if (!file.startsWith(`${root}${path.sep}`)) continue;
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  }
  return null;
}
```

- [ ] **Step 4: Прогнать тесты файла и починить вызовы**

Run: `npx vitest run src/lib/exercise/ && npm run typecheck`
Expected: тесты `file.test.ts` и `tree.test.ts` PASS; `typecheck` покажет сломанные вызовы в `reset.ts`, `recall.ts`, маршрутах и `run-tests.test.ts` — они правятся в задачах 3–8. На этом шаге допустимо оставить typecheck красным, но `vitest run src/lib/exercise/` должен быть зелёным.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/exercise/file.ts src/lib/exercise/file.test.ts
git commit -m "feat(exercise): read and write exercise files by name"
```

---

### Task 3: Сброс функции в нужном файле

**Files:**
- Modify: `src/lib/exercise/reset.ts`
- Test: `src/lib/exercise/reset.test.ts`

**Interfaces:**
- Consumes: `readExerciseTree`, `findTreeFile` (Task 1); `readExerciseFiles`, `writeExerciseFile` (Task 2).
- Produces: `resetFunctionToTemplate(sourceDir, ref, fn, fileName = "exercise.py"): ResetResult | { error: string }`, где `ResetResult` получает поле `name: string`.

- [ ] **Step 1: Написать падающий тест**

```ts
it("возвращает заготовку в тот файл, где функция объявлена", () => {
  const sourceDir = makeMulti();
  readExerciseFiles(sourceDir, p19);
  const hooks = path.join(sourceDir, "learning-exercises", "p19-l20-loop", "exercise", "hooks.py");
  fs.writeFileSync(hooks, "def fire(topic):\n    return 1\n", "utf8");

  const result = resetFunctionToTemplate(sourceDir, p19, "fire", "hooks.py");
  expect("error" in result).toBe(false);
  expect(fs.readFileSync(hooks, "utf8")).toContain("raise NotImplementedError");
  // Соседний файл не тронут: сброс адресный.
  const main = path.join(sourceDir, "learning-exercises", "p19-l20-loop", "exercise", "main.py");
  expect(fs.readFileSync(main, "utf8")).toContain("def run(goal)");
});

it("сообщает об ошибке, когда в заготовке этого файла такой функции нет", () => {
  const sourceDir = makeMulti();
  readExerciseFiles(sourceDir, p19);
  expect(resetFunctionToTemplate(sourceDir, p19, "fire", "main.py")).toEqual({
    error: "В заготовке main.py нет функции fire",
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/lib/exercise/reset.test.ts`
Expected: FAIL — четвёртый аргумент не принимается, сброс идёт в `exercise.py`.

- [ ] **Step 3: Реализация**

```ts
export interface ResetResult {
  name: string;
  code: string;
  functions: ExerciseFunction[];
  mtimeMs: number;
}

export function resetFunctionToTemplate(
  sourceDir: string,
  ref: LessonRef,
  fn: string,
  fileName = "exercise.py",
): ResetResult | { error: string } {
  const tree = readExerciseTree(sourceDir, ref);
  if (!tree) return { error: "У урока нет упражнения" };
  const target = findTreeFile(tree, fileName);
  if (!target) return { error: `В упражнении нет файла ${fileName}` };
  if (!fs.existsSync(target.templatePath)) {
    return { error: `У упражнения нет заготовки ${fileName}` };
  }

  const template = fs.readFileSync(target.templatePath, "utf8");
  const block = extractFunction(template, fn);
  if (!block) return { error: `В заготовке ${fileName} нет функции ${fn}` };

  const set = readExerciseFiles(sourceDir, ref);
  const state = set?.files.find((item) => item.name === fileName);
  if (!state) return { error: "У урока нет упражнения" };

  const code = state.functions.some((item) => item.fn === fn)
    ? replaceFunction(state.code, fn, block)
    : insertByTemplateOrder(state.code, template, fn, block);

  const written = writeExerciseFile(sourceDir, ref, fileName, code);
  return { name: fileName, code, functions: written.functions, mtimeMs: written.mtimeMs };
}
```

`insertByTemplateOrder` и `dropDebris` не меняются: они работают с текстом одного файла и его шаблоном.

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run src/lib/exercise/reset.test.ts`
Expected: PASS, включая все существующие тесты одно-файлового сброса.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/exercise/reset.ts src/lib/exercise/reset.test.ts
git commit -m "feat(exercise): reset a function inside the file that declares it"
```

---

### Task 4: Recall по файлам

**Files:**
- Modify: `src/lib/exercise/recall.ts`, `src/lib/source/written-functions.ts`
- Test: `src/lib/exercise/recall.test.ts`, `src/lib/source/written-functions.test.ts`

**Interfaces:**
- Consumes: `readExerciseCodeBySlug(sourceDir, slug, name)` (Task 2), `readExerciseFiles`, `writeExerciseFile`.
- Produces:
  - `WrittenFunction` получает поле `file: string`.
  - `PreviousImplementation` получает поле `file: string`.
  - `insertPreviousImplementation(sourceDir, ref, fn, previous, fileName = "exercise.py")`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// written-functions.test.ts
it("видит функции в каталожной форме упражнения", () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-written-multi-"));
  const dir = path.join(sourceDir, "learning-exercises", "p19-l20-loop", "exercise");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "main.py"), "def run(goal):\n    return 1\n", "utf8");
  fs.writeFileSync(path.join(dir, "hooks.py"), "def fire(topic):\n    return 2\n", "utf8");

  const written = readWrittenFunctions(sourceDir);
  expect(written.map((item) => [item.fn, item.file])).toEqual([
    ["run", "main.py"],
    ["fire", "hooks.py"],
  ]);
});

it("одно-файловое упражнение отдаёт file = exercise.py", () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-written-single-"));
  const dir = path.join(sourceDir, "learning-exercises", "p01-l02-beta");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "exercise.py"), "def transpose(M):\n    return M\n", "utf8");
  expect(readWrittenFunctions(sourceDir)[0].file).toBe("exercise.py");
});
```

```ts
// recall.test.ts
it("вставляет прошлую реализацию в указанный файл", () => {
  const sourceDir = makeCourseWithPrevious(); // фикстура ниже в этом же файле
  const previous = findPreviousImplementation(sourceDir, "run", "p19-l21-next")!;
  expect(previous.file).toBe("main.py");

  const result = insertPreviousImplementation(sourceDir, p19next, "run", previous, "main.py");
  expect("error" in result).toBe(false);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/lib/source/written-functions.test.ts src/lib/exercise/recall.test.ts`
Expected: FAIL — поля `file` нет.

- [ ] **Step 3: Реализация**

В `written-functions.ts` заменить тело цикла `readWrittenFunctions`:

```ts
export interface WrittenFunction {
  fn: string;
  exerciseSlug: string;
  lessonSlug: string | null;
  /** Файл внутри упражнения: `exercise.py` у старой формы, `main.py` и соседи у новой. */
  file: string;
  signature: string;
}

/**
 * Файлы человека в упражнении: `exercise.py` в корне (старая форма) или всё,
 * что лежит в `exercise/` (каталожная). Читается именно то, что человек
 * написал, а не шаблон: recall обещает «вот как ты это писал».
 */
function learnerFiles(dir: string): { name: string; path: string }[] {
  const flat = path.join(dir, "exercise.py");
  if (fs.existsSync(flat)) return [{ name: "exercise.py", path: flat }];
  const nested = path.join(dir, "exercise");
  if (!fs.existsSync(nested)) return [];
  return fs
    .readdirSync(nested)
    .filter((name) => name.endsWith(".py"))
    .sort()
    .map((name) => ({ name, path: path.join(nested, name) }));
}

export function readWrittenFunctions(sourceDir: string): WrittenFunction[] {
  const root = path.join(sourceDir, "learning-exercises");
  if (!fs.existsSync(root)) return [];

  const catalog = readCatalog(sourceDir);
  const written: WrittenFunction[] = [];
  for (const exerciseSlug of fs.readdirSync(root).sort()) {
    for (const file of learnerFiles(path.join(root, exerciseSlug))) {
      const source = fs.readFileSync(file.path, "utf8");
      for (const block of parseTopLevelFunctions(source)) {
        if (!isFunctionImplemented(block.body)) continue;
        written.push({
          fn: block.fn,
          exerciseSlug,
          lessonSlug: lessonSlugFor(catalog, exerciseSlug),
          file: file.name,
          signature: `${block.fn}(${block.params})`,
        });
      }
    }
  }
  return written;
}
```

Порядок файлов внутри каталожной формы здесь алфавитный (`main.py` не поднимается): списком пользуется только поиск по имени функции, а не UI, и алфавит достаточен и дешевле.

В `recall.ts`:

```ts
export interface PreviousImplementation {
  fn: string;
  exerciseSlug: string;
  lessonSlug: string | null;
  /** Файл, из которого взят код: нужен, чтобы карточка называла источник целиком. */
  file: string;
  code: string;
}

export function findPreviousImplementation(
  sourceDir: string,
  fn: string,
  excludeExerciseSlug: string,
): PreviousImplementation | null {
  const candidates = readWrittenFunctions(sourceDir).filter(
    (item) => item.fn === fn && item.exerciseSlug !== excludeExerciseSlug,
  );
  const latest = candidates.at(-1);
  if (!latest) return null;

  const source = readExerciseCodeBySlug(sourceDir, latest.exerciseSlug, latest.file);
  if (!source) return null;
  const code = extractFunction(source, fn);
  if (!code) return null;

  return {
    fn,
    exerciseSlug: latest.exerciseSlug,
    lessonSlug: latest.lessonSlug,
    file: latest.file,
    code,
  };
}

export function insertPreviousImplementation(
  sourceDir: string,
  ref: LessonRef,
  fn: string,
  previous: PreviousImplementation,
  fileName = "exercise.py",
): { code: string; functions: ExerciseFunction[]; changed: boolean } | { error: string } {
  const set = readExerciseFiles(sourceDir, ref);
  const state = set?.files.find((item) => item.name === fileName);
  if (!state) return { error: "У урока нет упражнения" };
  if (!state.functions.some((item) => item.fn === fn)) {
    return { error: `В упражнении этого урока нет функции ${fn} — вставить некуда` };
  }

  const code = replaceFunction(state.code, fn, previous.code);
  // «Замена не изменила текст» — не ошибка: так выглядит повторный заход на
  // тот же recall-шаг, где прошлый код уже стоит на месте.
  if (code === state.code) return { code, functions: state.functions, changed: false };

  const written = writeExerciseFile(sourceDir, ref, fileName, code);
  return { code, functions: written.functions, changed: true };
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run src/lib/source/written-functions.test.ts src/lib/exercise/recall.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/source/written-functions.ts src/lib/exercise/recall.ts src/lib/source/written-functions.test.ts src/lib/exercise/recall.test.ts
git commit -m "feat(exercise): carry the file name through recall lookups"
```

---

### Task 5: Тесты многофайлового упражнения

**Files:**
- Modify: `src/lib/practice/run-tests.ts`
- Test: `src/lib/practice/run-tests.test.ts`

**Interfaces:**
- Consumes: ничего из предыдущих задач напрямую (вызывающий передаёт готовые значения).
- Produces: `RunTestsOptions` получает два поля:
  ```ts
  /** Каталог, который добавляется в PYTHONPATH: файлы человека в каталожной форме. */
  pythonPath?: string;
  /** Путь тестового файла, если он не в cwd прогона. */
  testFile?: string;
  ```
  Плюс `buildTestFilter` остаётся как есть, а решение «не фильтровать» принимает вызывающий (Task 6).

- [ ] **Step 1: Написать падающий тест**

```ts
it("добавляет каталог файлов человека в PYTHONPATH", async () => {
  const dir = makeDir();
  const nested = path.join(dir, "exercise");
  fs.mkdirSync(nested, { recursive: true });
  const outcome = await runTests({
    dir,
    python: process.execPath,
    pythonPath: nested,
    testFile: path.join(dir, "test_exercise.py"),
  });
  // fake-python.mjs пишет полученные аргументы и окружение в argv.json
  const call = JSON.parse(fs.readFileSync(path.join(dir, "argv.json"), "utf8"));
  expect(call.env.PYTHONPATH.split(path.delimiter)).toContain(nested);
  expect(call.args).toContain(path.join(dir, "test_exercise.py"));
  expect(outcome.passed).toBeGreaterThanOrEqual(0);
});

it("не роняет прогон, когда PYTHONPATH уже задан в окружении", async () => {
  const dir = makeDir();
  const nested = path.join(dir, "exercise");
  fs.mkdirSync(nested, { recursive: true });
  process.env.PYTHONPATH = "/pre-existing";
  try {
    await runTests({ dir, python: process.execPath, pythonPath: nested });
    const call = JSON.parse(fs.readFileSync(path.join(dir, "argv.json"), "utf8"));
    expect(call.env.PYTHONPATH.split(path.delimiter)).toEqual([nested, "/pre-existing"]);
  } finally {
    delete process.env.PYTHONPATH;
  }
});
```

`tests/fixtures/practice/fake-python.mjs` дописывается так, чтобы рядом с JUnit-XML он сохранял `argv.json` с полями `args` и `env` (уже пишет XML — добавить дамп аргументов и `process.env`).

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/lib/practice/run-tests.test.ts`
Expected: FAIL — `pythonPath` не поддерживается, `argv.json` не создаётся.

- [ ] **Step 3: Реализация**

В `spawnOnce` добавить путь к тестовому файлу и окружение:

```ts
function spawnOnce(opts: {
  python: string;
  dir: string;
  filter?: string;
  junit: string;
  timeoutMs: number;
  pythonPath?: string;
  testFile?: string;
}): Promise<RawRun> {
  const args = ["-m", "pytest", "-q", "--no-header", "--junit-xml", opts.junit];
  if (opts.testFile) args.push(opts.testFile);
  if (opts.filter) args.push("-k", opts.filter);

  // PYTHONPATH, а не cwd: тесты курса лежат в каталоге упражнения и
  // импортируют модули по имени (`from main import ...`). Файлы человека в
  // каталожной форме живут в exercise/, и без этого пути pytest подхватил бы
  // либо ничего, либо соседний solution/. Существующее значение сохраняется:
  // затирать окружение машины ради своей строки нельзя.
  const env = opts.pythonPath
    ? {
        ...process.env,
        PYTHONPATH: [opts.pythonPath, process.env.PYTHONPATH]
          .filter((part) => part && part.length > 0)
          .join(path.delimiter),
      }
    : process.env;

  return new Promise((resolve, reject) => {
    const child = spawn(opts.python, args, {
      cwd: opts.dir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // …дальше без изменений
  });
}
```

`runTests` прокидывает `pythonPath` и `testFile` в оба вызова `spawnOnce` (отфильтрованный и откат на весь файл).

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run src/lib/practice/run-tests.test.ts`
Expected: PASS, включая существующие тесты фильтра.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/practice/run-tests.ts src/lib/practice/run-tests.test.ts tests/fixtures/practice/fake-python.mjs
git commit -m "feat(practice): run tests against a nested exercise directory"
```

---

### Task 6: Пара «файл + функция» в плане урока

**Files:**
- Modify: `src/lib/content/step-file.ts`, `src/lib/content/lesson-plan.ts`, `src/lib/source/lesson-source.ts`
- Test: `src/lib/content/lesson-plan.test.ts`, `src/lib/content/step-file.test.ts`

**Interfaces:**
- Consumes: `canonicalFunctions`, `readExerciseTree` (Task 1).
- Produces:
  - `stepMetaSchema` получает `exercise_file: z.string().optional()`.
  - `ExerciseInfo` в `lesson-source.ts`: `functions: { file: string; fn: string }[]`, плюс `multi: boolean`.
  - `validatePlan` проверяет пары.

- [ ] **Step 1: Написать падающие тесты**

```ts
// lesson-plan.test.ts
const multiSource = {
  // …остальные поля как в существующих тестах
  exercise: {
    slug: "p19-l20-loop",
    dir: "/tmp/p19-l20-loop",
    multi: true,
    functions: [
      { file: "main.py", fn: "run" },
      { file: "hooks.py", fn: "fire" },
      { file: "hooks.py", fn: "run" },
    ],
  },
};

it("требует exercise_file, когда имя функции есть в двух файлах", () => {
  const errors = validatePlan(
    [
      { id: "001-a", type: "theory", title: "Т" },
      { id: "002-b", type: "code", title: "К", exercise_fn: "run" },
    ],
    multiSource,
  );
  expect(errors).toContain(
    "Шаг 002-b: функция run есть в нескольких файлах упражнения (hooks.py, main.py) — укажи exercise_file",
  );
});

it("принимает пару файл+функция", () => {
  const errors = validatePlan(
    [
      { id: "001-a", type: "theory", title: "Т" },
      { id: "002-b", type: "code", title: "К", exercise_fn: "run", exercise_file: "main.py" },
      { id: "003-c", type: "theory", title: "Т" },
      { id: "004-d", type: "code", title: "К", exercise_fn: "fire", exercise_file: "hooks.py" },
      { id: "005-e", type: "theory", title: "Т" },
      { id: "006-f", type: "code", title: "К", exercise_fn: "run", exercise_file: "hooks.py" },
    ],
    multiSource,
  );
  expect(errors).toEqual([]);
});

it("ругается на файл, которого в упражнении нет", () => {
  const errors = validatePlan(
    [
      { id: "001-a", type: "theory", title: "Т" },
      { id: "002-b", type: "code", title: "К", exercise_fn: "run", exercise_file: "nope.py" },
    ],
    multiSource,
  );
  expect(errors).toContain("Шаг 002-b: в упражнении нет файла nope.py");
});

it("считает одну и ту же функцию в разных файлах разными задачами", () => {
  // main.py::run и hooks.py::run — две задачи, и занятость одной не должна
  // мешать другой.
  const errors = validatePlan(
    [
      { id: "001-a", type: "theory", title: "Т" },
      { id: "002-b", type: "code", title: "К", exercise_fn: "run", exercise_file: "main.py" },
      { id: "003-c", type: "theory", title: "Т" },
      { id: "004-d", type: "code", title: "К", exercise_fn: "run", exercise_file: "hooks.py" },
      { id: "005-e", type: "theory", title: "Т" },
      { id: "006-f", type: "code", title: "К", exercise_fn: "fire", exercise_file: "hooks.py" },
    ],
    multiSource,
  );
  expect(errors).toEqual([]);
});
```

Плюс тест на обратную совместимость: существующий одно-файловый план без `exercise_file` проходит валидацию как раньше (уже есть в файле, должен остаться зелёным).

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/lib/content/lesson-plan.test.ts`
Expected: FAIL — `functions` ожидается строковым массивом.

- [ ] **Step 3: Реализация**

`step-file.ts`:

```ts
export const stepMetaSchema = z.object({
  // …без изменений
  exercise_fn: z.string().optional(),
  /**
   * Файл упражнения, в котором живёт `exercise_fn`. Необязателен: у
   * одно-файлового упражнения он один и подразумевается, а у 382
   * существующих планов этого поля нет и появляться не должно.
   */
  exercise_file: z.string().optional(),
  // …остальное без изменений
});
```

`lesson-source.ts`:

```ts
export interface ExerciseInfo {
  slug: string;
  dir: string;
  multi: boolean;
  functions: { file: string; fn: string }[];
}

function readExercise(courseRepo: string, ref: LessonRef): ExerciseInfo | null {
  const tree = readExerciseTree(courseRepo, ref);
  if (!tree) return null;
  return {
    slug: tree.slug,
    dir: tree.dir,
    multi: tree.multi,
    functions: canonicalFunctions(tree),
  };
}
```

`lesson-plan.ts` — заменить работу с плоским `known`/`used` на пары:

```ts
const known = source.exercise?.functions ?? [];
const knownFiles = new Set(known.map((pair) => pair.file));
const byName = new Map<string, string[]>();
for (const pair of known) {
  byName.set(pair.fn, [...(byName.get(pair.fn) ?? []), pair.file]);
}
const key = (file: string, fn: string) => `${file}::${fn}`;
const used = new Set<string>();
const writtenByName = new Map(written.map((item) => [key(item.file, item.fn), item]));

// …внутри цикла по шагам, в ветке code/recall:
if (!step.exercise_fn) {
  errors.push(`Шаг ${step.id}: у ${step.type}-шага нет exercise_fn`);
} else {
  const files = byName.get(step.exercise_fn) ?? [];
  if (files.length === 0) {
    errors.push(`Шаг ${step.id}: функция ${step.exercise_fn} отсутствует в упражнении`);
  } else if (step.exercise_file && !knownFiles.has(step.exercise_file)) {
    errors.push(`Шаг ${step.id}: в упражнении нет файла ${step.exercise_file}`);
  } else if (!step.exercise_file && files.length > 1) {
    // Одно имя в двух файлах — это две разные задачи, и шаг обязан сказать,
    // о какой он. Угадать нельзя: и тесты, и сброс, и recall пишут в файл.
    errors.push(
      `Шаг ${step.id}: функция ${step.exercise_fn} есть в нескольких файлах упражнения ` +
        `(${[...files].sort().join(", ")}) — укажи exercise_file`,
    );
  } else {
    const file = step.exercise_file ?? files[0];
    if (used.has(key(file, step.exercise_fn))) {
      errors.push(
        `Шаг ${step.id}: функция ${step.exercise_fn} в ${file} уже занята другим шагом`,
      );
    }
    // …правило recall: writtenByName.has(key(file, step.exercise_fn))
    used.add(key(file, step.exercise_fn));
  }
}

// …покрытие в конце:
for (const pair of known) {
  if (!used.has(key(pair.file, pair.fn))) {
    errors.push(
      known.some((other) => other.fn === pair.fn && other.file !== pair.file)
        ? `Функция ${pair.fn} из ${pair.file} не покрыта ни одним code-шагом`
        : `Функция ${pair.fn} не покрыта ни одним code-шагом`,
    );
  }
}
```

Правило `baseline` (функция уже написана раньше) продолжает работать через `writtenByName` с ключом из пары.

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run src/lib/content/`
Expected: PASS, включая существующие тесты одно-файловых планов.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/content/step-file.ts src/lib/content/lesson-plan.ts src/lib/source/lesson-source.ts src/lib/content/lesson-plan.test.ts src/lib/content/step-file.test.ts
git commit -m "feat(content): address an exercise function by file and name"
```

---

### Task 7: Маршруты API

**Files:**
- Modify: `src/app/api/lesson/[slug]/exercise/route.ts`, `src/app/api/lesson/[slug]/exercise/reset/route.ts`, `src/app/api/lesson/[slug]/tests/route.ts`, `src/app/api/lesson/[slug]/recall/route.ts`
- Test: одноимённые `route.test.ts` рядом с каждым

**Interfaces:**
- Consumes: всё из задач 1–6.
- Produces:
  - `GET /api/lesson/<slug>/exercise` → `{ exerciseSlug, dir, multi, files: ExerciseFileState[] }`; с `?meta=1&file=<name>` → `{ mtimeMs }`.
  - `PUT /api/lesson/<slug>/exercise` принимает `{ file, code, mtimeMs }`; 409 отдаёт `{ error, current: { name, code, mtimeMs, functions } }`.
  - `POST .../exercise/reset` принимает `{ fn, file? }`.
  - `POST .../tests` берёт файл из `step.exercise_file`.
  - `GET/POST .../recall` принимают `file` (необязательный).

- [ ] **Step 1: Написать падающие тесты**

```ts
// exercise/route.test.ts
it("отдаёт список файлов упражнения", async () => {
  const response = await GET(new Request("http://localhost/api/lesson/x/exercise"), {
    params: Promise.resolve({ slug: multiSlug }),
  });
  const body = await response.json();
  expect(body.multi).toBe(true);
  expect(body.files.map((file: { name: string }) => file.name)).toEqual([
    "main.py", "events.py", "hooks.py",
  ]);
});

it("PUT без поля file отвечает 400", async () => {
  const response = await PUT(
    new Request("http://localhost/api/lesson/x/exercise", {
      method: "PUT",
      body: JSON.stringify({ code: "x = 1\n", mtimeMs: 1 }),
    }),
    { params: Promise.resolve({ slug: multiSlug }) },
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe("Не передано поле file");
});

it("PUT пишет в указанный файл", async () => { /* … */ });
it("PUT в файл вне шаблона отвечает 400", async () => { /* … */ });
```

```ts
// tests/route.test.ts
it("гоняет тесты без фильтра, когда имя функции шага есть в двух файлах", async () => {
  // Упражнение, где run объявлен и в main.py, и в hooks.py.
  const response = await POST(/* … */);
  const body = await response.json();
  expect(body.filtered).toBe(false);
  expect(body.warning).toBe(
    "Функция run есть в нескольких файлах упражнения — прогнан весь файл тестов",
  );
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/app/api/lesson`
Expected: FAIL.

- [ ] **Step 3: Реализация**

`exercise/route.ts`:

```ts
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = loadConfig();
  const ref = findLesson(config.sourceDir, slug);
  if (!ref) return Response.json({ error: "Урок не найден" }, { status: 404 });

  const url = new URL(request.url);
  if (url.searchParams.get("meta") === "1") {
    // Имя файла обязательно: у многофайлового упражнения «время изменения
    // упражнения» — это не одно число, и молча взять первый файл значило бы
    // не замечать правку остальных.
    const name = url.searchParams.get("file") ?? "exercise.py";
    const mtimeMs = exerciseFileMtimeMs(config.sourceDir, ref, name);
    if (mtimeMs === null) {
      return Response.json({ error: `У этого урока нет файла ${name}` }, { status: 404 });
    }
    return Response.json({ mtimeMs });
  }

  const set = readExerciseFiles(config.sourceDir, ref);
  if (!set) return Response.json({ error: "У этого урока нет упражнения" }, { status: 404 });
  return Response.json(set);
}

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as PutBody;
  const code = typeof body.code === "string" ? body.code : null;
  const file = typeof body.file === "string" ? body.file.trim() : "";
  const expectedMtimeMs =
    typeof body.mtimeMs === "number" && Number.isFinite(body.mtimeMs) ? body.mtimeMs : null;

  if (code === null) return Response.json({ error: "Не передано поле code" }, { status: 400 });
  if (code.trim().length === 0) {
    return Response.json({ error: "Пустой код — запись отклонена" }, { status: 400 });
  }
  if (!file) return Response.json({ error: "Не передано поле file" }, { status: 400 });
  if (expectedMtimeMs === null) {
    return Response.json({ error: "Не передано поле mtimeMs" }, { status: 400 });
  }

  const config = loadConfig();
  const ref = findLesson(config.sourceDir, slug);
  if (!ref) return Response.json({ error: "Урок не найден" }, { status: 404 });

  try {
    const result = writeExerciseFileIfUnchanged(
      config.sourceDir, ref, file, code, expectedMtimeMs,
    );
    if ("conflict" in result) {
      return Response.json(
        {
          error: "Файл упражнения изменился на диске — редактор перечитает его",
          current: result.conflict,
        },
        { status: 409 },
      );
    }
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
```

`tests/route.ts` — файл берётся из шага, фильтр отключается на дубле:

```ts
const tree = readExerciseTree(config.sourceDir, ref);
if (!tree) return Response.json({ error: "У этого урока нет упражнения" }, { status: 404 });

const fileName = step.exercise_file ?? "exercise.py";
const duplicated = tree.duplicateFunctions.includes(step.exercise_fn);
const outcome = await runTests({
  dir: tree.dir,
  // Фильтр `-k` про файлы не знает: на дублирующемся имени он собрал бы тесты
  // соседнего модуля. Честнее прогнать весь файл и сказать об этом.
  fn: duplicated ? undefined : step.exercise_fn,
  functions: readCanonicalFunctionNames(config.sourceDir, ref),
  python: config.python,
  pythonPath: tree.multi ? path.join(tree.dir, "exercise") : undefined,
  testFile: tree.testPath ?? undefined,
});
const warning = duplicated
  ? `Функция ${step.exercise_fn} есть в нескольких файлах упражнения — прогнан весь файл тестов`
  : outcome.warning;
```

`recordTestRun` продолжает получать `step.exercise_fn`; для многофайлового упражнения в него уходит `${fileName}::${step.exercise_fn}` — иначе две одноимённые функции сливаются в одну строку истории.

`reset/route.ts` и `recall/route.ts` — читают необязательное поле `file` из тела запроса и передают четвёртым (соответственно пятым) аргументом.

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run src/app/api/lesson && npm run typecheck`
Expected: PASS, typecheck чистый.

- [ ] **Step 5: Коммит**

```bash
git add src/app/api/lesson
git commit -m "feat(api): address exercise files by name in the practice endpoints"
```

---

### Task 8: Замер отдельного модуля

**Files:**
- Modify: `scripts/bench.py`, `src/lib/practice/bench.ts`, `src/app/api/lesson/[slug]/review/route.ts`
- Test: `src/lib/practice/bench.test.ts`

**Interfaces:**
- Consumes: `readExerciseTree` (Task 1).
- Produces: `runBench` получает поле `module?: string` (имя файла упражнения); `scripts/bench.py` — ключ `--module main.py`.

- [ ] **Step 1: Написать падающий тест**

```ts
it("передаёт скрипту имя модуля упражнения", async () => {
  const calls: string[][] = [];
  // фикстура fake-python пишет argv в файл, как в run-tests.test.ts
  await runBench({ dir, python: process.execPath, module: "main.py" }).catch(() => {});
  const call = JSON.parse(fs.readFileSync(path.join(dir, "argv.json"), "utf8"));
  expect(call.args).toContain("--module");
  expect(call.args).toContain("main.py");
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/lib/practice/bench.test.ts`
Expected: FAIL — поля `module` нет.

- [ ] **Step 3: Реализация**

`bench.ts`:

```ts
const args = [path.join(process.cwd(), "scripts", "bench.py"), options.dir];
if (options.fn) args.push("--fn", options.fn);
// Имя модуля, а не путь: скрипт сам знает, где в упражнении лежат файлы
// человека и эталона, и путь из запроса ему передавать незачем.
if (options.module) args.push("--module", options.module);
```

`scripts/bench.py`:

```python
parser.add_argument("--fn", default=None)
parser.add_argument(
    "--module",
    default=None,
    help="Файл упражнения в каталожной форме: main.py, hooks.py. "
         "Без него берётся exercise.py в корне каталога.",
)
# …
if args.module:
    mine_path = lesson_dir / "exercise" / args.module
    ref_path = lesson_dir / "solution" / args.module
else:
    mine_path = lesson_dir / "exercise.py"
    ref_path = lesson_dir / "solution.py"
```

`review/route.ts` передаёт `module` из `step.exercise_file`, когда упражнение многофайловое.

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run src/lib/practice/bench.test.ts && python3 scripts/bench.py source/learning-exercises/p01-l02-vectors-matrices-operations | head -5`
Expected: тест PASS; ручной прогон на существующем одно-файловом упражнении печатает JSON как раньше.

- [ ] **Step 5: Коммит**

```bash
git add scripts/bench.py src/lib/practice/bench.ts src/lib/practice/bench.test.ts src/app/api/lesson/\[slug\]/review/route.ts
git commit -m "feat(practice): bench one module of a multi-file exercise"
```

---

### Task 9: Табы файлов в панели практики

**Files:**
- Modify: `src/components/ExercisePanel.tsx`, `src/app/lesson/[slug]/reader.tsx`
- Test: `src/components/ExercisePanel.test.tsx` (создаётся, если ещё нет — vitest + `@testing-library/react`; если библиотеки в проекте нет, проверяется чистая функция выбора активного файла, вынесенная в `src/lib/editor/active-file.ts` с тестом рядом)

**Interfaces:**
- Consumes: `GET /exercise` со списком файлов (Task 7).
- Produces: `ExercisePanel` получает проп `file?: string`; новая чистая функция
  ```ts
  // src/lib/editor/active-file.ts
  export function pickActiveFile(names: string[], stepFile: string | undefined, current: string | null): string;
  ```

- [ ] **Step 1: Написать падающий тест на выбор активного файла**

```ts
// src/lib/editor/active-file.test.ts
import { describe, expect, it } from "vitest";
import { pickActiveFile } from "./active-file";

describe("pickActiveFile", () => {
  it("открывает файл шага, когда шаг его называет", () => {
    expect(pickActiveFile(["main.py", "hooks.py"], "hooks.py", null)).toBe("hooks.py");
  });

  it("уважает выбор человека, пока шаг не сменил файл", () => {
    // Человек открыл соседний таб, чтобы посмотреть каркас: переключать его
    // обратно на каждый ререндер нельзя.
    expect(pickActiveFile(["main.py", "hooks.py"], undefined, "hooks.py")).toBe("hooks.py");
  });

  it("файл шага перебивает прежний выбор", () => {
    expect(pickActiveFile(["main.py", "hooks.py"], "main.py", "hooks.py")).toBe("main.py");
  });

  it("падает на первый файл, когда ни шаг, ни человек ничего не выбрали", () => {
    expect(pickActiveFile(["main.py", "hooks.py"], undefined, null)).toBe("main.py");
  });

  it("не отдаёт файл, которого больше нет в упражнении", () => {
    expect(pickActiveFile(["main.py"], "gone.py", "also-gone.py")).toBe("main.py");
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/lib/editor/active-file.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализация функции и панели**

```ts
// src/lib/editor/active-file.ts
/**
 * Какой файл упражнения показывать.
 *
 * Приоритет у файла шага, а не у выбора человека: шаг переключает практику на
 * свою функцию, и оставить открытым соседний файл значило бы показать
 * редактор, в котором функции шага нет. Но пока шаг молчит (теория, соседний
 * таб открыт вручную), выбор человека сохраняется.
 */
export function pickActiveFile(
  names: string[],
  stepFile: string | undefined,
  current: string | null,
): string {
  if (stepFile && names.includes(stepFile)) return stepFile;
  if (current && names.includes(current)) return current;
  return names[0];
}
```

В `ExercisePanel`:

- состояние `data` становится `{ multi: boolean; files: ExerciseFileState[] }`, `code` — черновик активного файла, `savedCodeRef`/`mtimeRef` — `Map<string, …>` по имени файла (черновик соседнего файла не должен теряться при переключении таба);
- новый проп `file?: string` (из `step.exercise_file`), активный файл считается `pickActiveFile`;
- над `CodeEditor` рисуется полоска табов; таб показывается только при `multi` — у одно-файлового упражнения полоска не появляется вовсе;
- `PUT` шлёт `{ file: active, code, mtimeMs }`;
- опрос внешних правок (`?meta=1`) шлёт `&file=<active>`;
- `flush()` перед прогоном тестов добивает запись активного файла, как сейчас.

В `reader.tsx` — прокинуть файл:

```tsx
{step.type === "code" && step.exercise_fn && (
  <>
    <PracticeStatus />
    <ExercisePanel
      slug={slug}
      stepId={step.id}
      fn={step.exercise_fn}
      file={step.exercise_file}
      lspUrl={lspUrl}
      onProgressChanged={() => void load()}
    />
  </>
)}
```

и то же поле в `RecallCard` (`file={step.exercise_file}`), чтобы вставка шла в нужный файл.

- [ ] **Step 4: Прогнать тесты и проверить руками**

Run: `npx vitest run src/lib/editor/active-file.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

Ручная проверка: `npm run dev`, открыть существующий одно-файловый урок — полоски табов нет, всё как раньше; редактор сохраняет и гоняет тесты.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/editor/active-file.ts src/lib/editor/active-file.test.ts src/components/ExercisePanel.tsx src/app/lesson/\[slug\]/reader.tsx
git commit -m "feat(site): switch between the files of one exercise with tabs"
```

---

### Task 10: Каталожная форма в статической сборке

**Files:**
- Modify: `src/lib/site/exercise.ts`, `scripts/build-site.mts`
- Test: `src/lib/site/exercise.test.ts`

**Interfaces:**
- Consumes: `readExerciseTree` (Task 1) — статическая сборка читает ту же форму тем же кодом.
- Produces: `ExerciseBundle` получает `files: { name: string; templatePath: string; solutionPath: string | null }[]` вместо одиночного `templatePath`/`solutionPath`; `exerciseUrls` и `exerciseFiles` работают со списком.

- [ ] **Step 1: Написать падающий тест**

```ts
it("собирает адреса всех файлов многофайлового упражнения", () => {
  const bundle = findLessonExercise(makeMulti(), "19-capstone-projects__20-loop")!;
  expect(exerciseFiles(bundle).map((item) => item.to)).toEqual([
    "exercise/p19-l20-loop/template/main.py",
    "exercise/p19-l20-loop/template/events.py",
    "exercise/p19-l20-loop/template/hooks.py",
    "exercise/p19-l20-loop/test.py",
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
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/lib/site/exercise.test.ts`
Expected: FAIL — `exerciseFiles` знает про один шаблон.

- [ ] **Step 3: Реализация**

`findLessonExercise` переписывается на `readExerciseTree` (номера фазы и урока он и так вытаскивает из slug'а регуляркой `LESSON_SLUG`), `exerciseUrls`/`exerciseFiles` возвращают список. Раскладка в сборке: одно-файловая форма остаётся `template.py`/`test.py`/`solution.py` (адреса уже разошлись по опубликованному сайту), каталожная кладётся в подкаталоги `template/` и `solution/`.

- [ ] **Step 4: Прогнать тесты и собрать сайт**

Run: `npx vitest run src/lib/site/ && npm run site:build`
Expected: тесты PASS; сборка проходит, в `out/exercise/` у старых упражнений файлы лежат там же, где раньше.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/site/exercise.ts src/lib/site/exercise.test.ts scripts/build-site.mts
git commit -m "feat(site): publish every file of a multi-file exercise"
```

---

### Task 11: Проверка на живом упражнении фазы 19

**Files:**
- Create: `source/learning-exercises/p19-l20-agent-harness-loop-contract/exercise.template/`, `solution/`, `test_exercise.py` (вручную, из `source/phases/19-capstone-projects/20-agent-harness-loop-contract/`)
- Modify: ничего

Это приёмка плана: первая настоящая многофайловая раскладка, собранная руками. Автоматический вывод упражнения из кода курса — задача плана 2, здесь проверяется, что механика работает на реальном материале.

- [ ] **Step 1: Разложить упражнение руками**

```bash
cd /Users/oleksandr/ai-course-lab
SRC=source/phases/19-capstone-projects/20-agent-harness-loop-contract
DST=source/learning-exercises/p19-l20-agent-harness-loop-contract
mkdir -p $DST/exercise.template $DST/solution
cp $SRC/code/main.py $DST/solution/main.py
cp $SRC/code/main.py $DST/exercise.template/main.py
cp $SRC/code/tests/test_loop.py $DST/test_exercise.py
```

Затем в `$DST/exercise.template/main.py` вырезать тела двух методов `HarnessLoop._transition` и `HookRegistry.fire`, заменив их на docstring с условием и `raise NotImplementedError`.

- [ ] **Step 2: Проверить, что эталон зелёный**

Run:
```bash
PYTHONPATH=source/learning-exercises/p19-l20-agent-harness-loop-contract/solution \
  python3 -m pytest -q source/learning-exercises/p19-l20-agent-harness-loop-contract/test_exercise.py
```
Expected: все тесты PASS. Если нет — тесты курса опираются на что-то за пределами `main.py`, и это надо выяснить до плана 2.

- [ ] **Step 3: Проверить, что шаблон красный**

Run:
```bash
mkdir -p source/learning-exercises/p19-l20-agent-harness-loop-contract/exercise
cp source/learning-exercises/p19-l20-agent-harness-loop-contract/exercise.template/main.py \
   source/learning-exercises/p19-l20-agent-harness-loop-contract/exercise/main.py
PYTHONPATH=source/learning-exercises/p19-l20-agent-harness-loop-contract/exercise \
  python3 -m pytest -q source/learning-exercises/p19-l20-agent-harness-loop-contract/test_exercise.py
```
Expected: FAIL с `NotImplementedError`. Это та самая двусторонняя приёмка из спеки, проверенная руками до того, как её начнёт делать генератор.

- [ ] **Step 4: Проверить в браузере**

Run: `npm run dev`, открыть урок фазы 19 (`/lesson/19-capstone-projects__20-agent-harness-loop-contract`) после того, как у него появится план хотя бы с одним code-шагом с `exercise_file: main.py`.
Expected: панель практики показывает табы, редактор открывает `main.py`, Run гоняет тесты и краснеет на нереализованном методе.

- [ ] **Step 5: Коммит**

```bash
git add source/learning-exercises/p19-l20-agent-harness-loop-contract
git commit -m "test(phase-19): lay out the first multi-file exercise by hand"
```

---

## Self-Review

**Покрытие спеки (раздел «Редактор, раннер, проверки среды»):**

| Требование спеки | Задача |
|---|---|
| `GET` отдаёт массив файлов, `PUT` принимает `file` | 7 |
| Проверка пути: внутри `learning-exercises`, `.py`, вхождение в шаблон | 1 (`findTreeFile`, `SAFE_NAME`), 2 (`workFilePath`) |
| Новые файлы человек не создаёт | 1, 2 — запись только в имена из шаблона |
| Совместимость 382 упражнений | 1 (`multi: false`), 2, 6 (`exercise_file` необязателен), 10 |
| Табы, не дерево | 9 |
| Межфайловые импорты через pyright `rootUri` | не требует изменений: `CodeEditor` уже держит модель на файл, а `rootUri` указывает на каталог упражнения. Проверяется руками в задаче 11, шаг 4 |
| `exercise_fn` как пара файл + функция | 6 |
| Совпадение имён: предупреждение и прогон всего файла | 1 (`duplicateFunctions`), 7 (отказ от `-k`) |
| `reset` по файлу | 3 |
| `recall` по тройке slug + файл + функция | 4 |
| `bench.py` получает имя файла | 8 |

**Отклонение от спеки, сознательное:** спека говорит, что предупреждение о совпадении имён печатается «на импорте». Реализовано иначе — в момент сборки фильтра тестов (`duplicateFunctions` в `readExerciseTree`, отказ от `-k` в маршруте). Причина: импорт — это копирование файлов, он не разбирает Python и печатает в терминал, которого человек в момент прогона тестов не видит. Проверка живёт там, где принимается решение, и её видно на экране прогона. Спеку под это править не нужно: смысл требования сохранён.

**Что осталось за пределами плана 1** (уходит в план 2 и 3): вывод упражнения из `code/main.py` автоматически, `plan-lab.md`, прогон скрипта для серии 76–81, проверка зависимостей в `health.ts`, треки на главном экране, капстоуны.
