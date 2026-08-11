# Import and Reimport Lessons From Upstream — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Кнопка в каталоге, которая тянет свежий курс с рут-репозитория в собственный кэш-клон и импортирует или переимпортирует урок, не трогая ни репозиторий пользователя, ни его решение упражнения.

**Architecture:** Лаба держит свой shallow-клон `rohitg00/ai-engineering-from-scratch` в `.cache/course-repo` и обновляет его через `fetch` + `reset --hard`. `loadConfig().courseRepo` начинает означать «эффективный репозиторий курса»: кэш-клон, если он есть, иначе `COURSE_REPO`. `importLesson` учится перезаписывать существующие файлы, кроме `exercise.py` учащегося. Логика запроса живёт в `src/lib/source/import-request.ts`, роут — тонкий, кнопка — клиентский компонент.

**Tech Stack:** Next.js 16 (App Router, серверные компоненты), TypeScript, vitest, `node:child_process` для git. Новых зависимостей нет.

## Global Constraints

- Весь текст, видимый человеку (сообщения об ошибках, подписи кнопок, логи CLI), — по-русски.
- Новых npm-зависимостей не добавлять. Git вызывается через `node:child_process`.
- Комментарии в коде пишутся только там, где объясняют **почему**, в стиле остальных файлов проекта. Не пересказывать код.
- Тесты — vitest, файлы `*.test.ts` рядом с модулем. `vitest.config.mts` собирает только `src/**/*.test.ts`, поэтому тестов на `.tsx`-компоненты в проекте нет и в этом плане не появляется.
- Репозиторий пользователя (`COURSE_REPO`) не участвует ни в одной git-команде. Ни `fetch`, ни `merge`, ни смены ветки в нём.
- `source/learning-exercises/*/exercise.py` не перезаписывается никогда.
- После каждой задачи должны быть зелёными: `npm test`, `npm run lint`, `npm run typecheck`.
- Ветка работы — текущая (`feat/labs`). Коммиты частые, по одному на задачу.
- Рут-репозиторий по умолчанию: `https://github.com/rohitg00/ai-engineering-from-scratch.git`, ветка `main`.

## File Structure

**Создаются:**
- `src/lib/source/upstream.ts` — клон/обновление кэша апстрима. Знает про git и про метку свежести, не знает про уроки.
- `src/lib/source/upstream.test.ts`
- `src/lib/source/import-request.ts` — «импортировать урок по слагу»: обновить апстрим, найти урок, выбрать режим, позвать импортёр. Не знает про HTTP.
- `src/lib/source/import-request.test.ts`
- `src/app/api/catalog/import/route.ts` — тонкий роут: разбор тела, коды ответов.
- `src/app/api/catalog/import/route.test.ts` — валидация тела (как в остальных route-тестах проекта).
- `src/components/ImportButton.tsx` — кнопка со своими состояниями.

**Меняются:**
- `src/lib/config.ts` — поля `upstreamDir`/`upstreamRemote`/`upstreamBranch`, `courseRepo` становится эффективным, экспортируется `effectiveCourseRepo`.
- `src/lib/config.test.ts` — тесты на выбор эффективного репозитория.
- `src/lib/source/import-lesson.ts` — режим перезаписи, `isLearnerOwned`, новая форма `ImportResult`.
- `src/lib/source/import-lesson.test.ts` — новые случаи + правка теста, который ждёт `skipped`.
- `src/app/page.tsx` — кнопка в обеих ветках строки урока.
- `scripts/import-lesson.mjs` — флаг `--force`, репозиторий из `loadConfig`.
- `.gitignore` — `/.cache`.
- `.env.example` — `UPSTREAM_REPO`, `UPSTREAM_BRANCH`.

**Порядок:** Задача 1 (кэш) и Задача 3 (перезапись) независимы. Задача 2 (config) зависит от 1 только по имени каталога. Задача 4 склеивает 1–3, Задача 5 — роут, Задача 6 — UI, Задача 7 — CLI.

---

### Task 1: Кэш-клон апстрима

**Files:**
- Create: `src/lib/source/upstream.ts`
- Test: `src/lib/source/upstream.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `type GitRunner = (args: string[], cwd: string) => string`
  - `interface UpstreamOptions { dir: string; remote: string; branch: string; maxAgeMs: number; now?: number; git?: GitRunner }`
  - `interface UpstreamResult { dir: string; head: string | null; fetched: boolean; fetchedAt: number | null; error?: string }`
  - `function ensureUpstream(options: UpstreamOptions): UpstreamResult` — бросает, только если клона нет и `clone` не удался.
  - `function hasClone(dir: string): boolean`

- [ ] **Step 1: Написать падающие тесты**

Create `src/lib/source/upstream.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureUpstream, hasClone } from "./upstream";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "upstream-"));
}

/** Каталог кэша, которого ещё нет: ensureUpstream должен его склонировать. */
function freshTarget(): string {
  return path.join(tmpDir(), "course-repo");
}

/** Уже «склонированный» кэш: .git на месте, метка свежести с заданным возрастом. */
function clonedTarget(ageMs: number | null): string {
  const dir = path.join(tmpDir(), "course-repo");
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  if (ageMs !== null) {
    const marker = `${dir}.fetched`;
    fs.writeFileSync(marker, "x", "utf8");
    const at = new Date(Date.now() - ageMs);
    fs.utimesSync(marker, at, at);
  }
  return dir;
}

function recorder(head = "abc1234") {
  const calls: { args: string[]; cwd: string }[] = [];
  const git = (args: string[], cwd: string): string => {
    calls.push({ args, cwd });
    return args[0] === "rev-parse" ? head : "";
  };
  return { calls, git };
}

const REMOTE = "https://example.invalid/course.git";

describe("ensureUpstream", () => {
  it("клонирует, когда каталога кэша ещё нет", () => {
    const dir = freshTarget();
    const { calls, git } = recorder();

    const result = ensureUpstream({ dir, remote: REMOTE, branch: "main", maxAgeMs: 1000, git });

    expect(calls[0].args).toEqual([
      "clone", "--depth", "1", "--single-branch", "--branch", "main", REMOTE, dir,
    ]);
    expect(result.fetched).toBe(true);
    expect(result.head).toBe("abc1234");
    expect(fs.existsSync(`${dir}.fetched`)).toBe(true);
  });

  it("обновляет кэш, когда метка протухла", () => {
    const dir = clonedTarget(10 * 60_000);
    const { calls, git } = recorder();

    const result = ensureUpstream({ dir, remote: REMOTE, branch: "main", maxAgeMs: 5 * 60_000, git });

    expect(calls.map((call) => call.args[0])).toEqual(["fetch", "reset", "rev-parse"]);
    expect(calls[0].args).toEqual(["fetch", "--depth", "1", "origin", "main"]);
    expect(calls[1].args).toEqual(["reset", "--hard", "FETCH_HEAD"]);
    expect(calls[1].cwd).toBe(dir);
    expect(result.fetched).toBe(true);
  });

  it("не ходит в сеть, пока метка свежая", () => {
    const dir = clonedTarget(30_000);
    const { calls, git } = recorder();

    const result = ensureUpstream({ dir, remote: REMOTE, branch: "main", maxAgeMs: 5 * 60_000, git });

    expect(calls.map((call) => call.args[0])).toEqual(["rev-parse"]);
    expect(result.fetched).toBe(false);
    expect(result.fetchedAt).not.toBeNull();
  });

  // Устаревший курс лучше, чем неработающая кнопка: упавший fetch при живом
  // клоне отдаётся полем error, а не исключением.
  it("переживает упавший fetch, если клон на месте", () => {
    const dir = clonedTarget(10 * 60_000);
    const git = (args: string[]): string => {
      if (args[0] === "fetch") throw new Error("сеть недоступна");
      return "abc1234";
    };

    const result = ensureUpstream({ dir, remote: REMOTE, branch: "main", maxAgeMs: 1000, git });

    expect(result.error).toContain("сеть недоступна");
    expect(result.fetched).toBe(false);
    expect(result.dir).toBe(dir);
  });

  it("бросает, если клона нет и склонировать не вышло", () => {
    const dir = freshTarget();
    const git = (): string => {
      throw new Error("сеть недоступна");
    };

    expect(() => ensureUpstream({ dir, remote: REMOTE, branch: "main", maxAgeMs: 1000, git }))
      .toThrow(/сеть недоступна/);
  });

  // Оборванный clone оставляет каталог, в котором нет рабочего репозитория.
  // Если его не убрать, следующий вызов увидит hasClone() и пойдёт делать
  // fetch в пустоте — вместо того чтобы просто попробовать клонировать снова.
  it("убирает за собой каталог после неудачного clone", () => {
    const dir = freshTarget();
    const git = (args: string[]): string => {
      fs.mkdirSync(dir, { recursive: true });
      throw new Error(`оборвалось на ${args[0]}`);
    };

    expect(() => ensureUpstream({ dir, remote: REMOTE, branch: "main", maxAgeMs: 1000, git })).toThrow();
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe("hasClone", () => {
  it("отличает готовый клон от пустого места", () => {
    expect(hasClone(freshTarget())).toBe(false);
    expect(hasClone(clonedTarget(0))).toBe(true);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/lib/source/upstream.test.ts`
Expected: FAIL — `Failed to resolve import "./upstream"`.

- [ ] **Step 3: Написать модуль**

Create `src/lib/source/upstream.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export type GitRunner = (args: string[], cwd: string) => string;

const execGit: GitRunner = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export interface UpstreamOptions {
  dir: string;
  remote: string;
  branch: string;
  maxAgeMs: number;
  now?: number;
  git?: GitRunner;
}

export interface UpstreamResult {
  dir: string;
  /** Короткий SHA головы кэша, null — если прочитать не вышло. */
  head: string | null;
  fetched: boolean;
  fetchedAt: number | null;
  /** Апстрим опросить не удалось, но кэш на месте и им можно пользоваться. */
  error?: string;
}

/**
 * Метка последнего опроса апстрима — файл РЯДОМ с каталогом клона, а не
 * `.git/FETCH_HEAD` внутри него: после `clone` FETCH_HEAD не создаётся, и
 * случай «только что склонировали» пришлось бы отличать особым правилом.
 */
function markerPath(dir: string): string {
  return `${dir}.fetched`;
}

function lastFetchAt(dir: string): number | null {
  const marker = markerPath(dir);
  return fs.existsSync(marker) ? fs.statSync(marker).mtimeMs : null;
}

function markFetched(dir: string, now: number): void {
  fs.writeFileSync(markerPath(dir), `${new Date(now).toISOString()}\n`, "utf8");
}

export function hasClone(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git"));
}

function readHead(dir: string, git: GitRunner): string | null {
  try {
    return git(["rev-parse", "--short", "HEAD"], dir).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Приводит кэш-клон курса в актуальное состояние и возвращает путь к нему.
 *
 * `reset --hard` здесь безопасен по построению: каталог создан лабой, в него
 * никто не пишет, локальных правок в нём быть не может. Репозиторий
 * пользователя из COURSE_REPO не участвует ни в одной команде — именно ради
 * этого кэш и заведён: у форка грязное рабочее дерево и своя ветка.
 */
export function ensureUpstream(options: UpstreamOptions): UpstreamResult {
  const { dir, remote, branch, maxAgeMs } = options;
  const git = options.git ?? execGit;
  const now = options.now ?? Date.now();

  if (!hasClone(dir)) {
    const parent = path.dirname(dir);
    fs.mkdirSync(parent, { recursive: true });
    try {
      git(["clone", "--depth", "1", "--single-branch", "--branch", branch, remote, dir], parent);
    } catch (error) {
      // Оборванный clone оставляет каталог без рабочего репозитория, а он
      // выглядит для hasClone() как готовый кэш. Лучше пустое место.
      fs.rmSync(dir, { recursive: true, force: true });
      throw error;
    }
    markFetched(dir, now);
    return { dir, head: readHead(dir, git), fetched: true, fetchedAt: now };
  }

  const at = lastFetchAt(dir);
  if (at !== null && now - at < maxAgeMs) {
    return { dir, head: readHead(dir, git), fetched: false, fetchedAt: at };
  }

  try {
    git(["fetch", "--depth", "1", "origin", branch], dir);
    git(["reset", "--hard", "FETCH_HEAD"], dir);
  } catch (error) {
    return { dir, head: readHead(dir, git), fetched: false, fetchedAt: at, error: (error as Error).message };
  }

  markFetched(dir, now);
  return { dir, head: readHead(dir, git), fetched: true, fetchedAt: now };
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run src/lib/source/upstream.test.ts`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/source/upstream.ts src/lib/source/upstream.test.ts
git commit -m "feat(source): keep a cache clone of the root course repository"
```

---

### Task 2: Эффективный репозиторий курса в config

**Files:**
- Modify: `src/lib/config.ts`
- Modify: `src/lib/config.test.ts`
- Modify: `.gitignore`
- Modify: `.env.example`

**Interfaces:**
- Consumes: имя каталога кэша из Задачи 1 (`.cache/course-repo`).
- Produces:
  - `Config` получает `upstreamDir: string`, `upstreamRemote: string`, `upstreamBranch: string`.
  - `Config.courseRepo` теперь эффективный: кэш-клон, если в нём есть `phases/`, иначе `COURSE_REPO`, иначе `null`.
  - `function effectiveCourseRepo(upstreamDir: string, courseRepo: string | null): string | null`

- [ ] **Step 1: Написать падающие тесты**

Добавить в конец `describe("loadConfig", ...)` в `src/lib/config.test.ts` (импорт наверху файла становится `import { effectiveCourseRepo, loadConfig } from "./config";`, добавить `import fs from "node:fs"; import os from "node:os";`):

```ts
  it("апстрим по умолчанию — рут-репозиторий и ветка main", () => {
    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    expect(cfg.upstreamRemote).toBe("https://github.com/rohitg00/ai-engineering-from-scratch.git");
    expect(cfg.upstreamBranch).toBe("main");
    expect(cfg.upstreamDir.endsWith(path.join(".cache", "course-repo"))).toBe(true);
  });

  it("UPSTREAM_REPO и UPSTREAM_BRANCH переопределяют апстрим", () => {
    const cfg = loadConfig({
      NODE_ENV: "test",
      UPSTREAM_REPO: "https://example.invalid/fork.git",
      UPSTREAM_BRANCH: "trunk",
    } as NodeJS.ProcessEnv);
    expect(cfg.upstreamRemote).toBe("https://example.invalid/fork.git");
    expect(cfg.upstreamBranch).toBe("trunk");
  });
});

describe("effectiveCourseRepo", () => {
  function cacheWithPhases(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-"));
    fs.mkdirSync(path.join(dir, "phases"), { recursive: true });
    return dir;
  }

  it("кэш-клон выигрывает у COURSE_REPO: он свежее по построению", () => {
    const cache = cacheWithPhases();
    expect(effectiveCourseRepo(cache, FIXTURE)).toBe(cache);
  });

  // Каталог кэша может существовать после оборванного клона. Пустая
  // директория — не курс, и падать обратно на COURSE_REPO здесь правильнее,
  // чем показать пустой каталог уроков.
  it("кэш без phases/ игнорируется", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "cache-"));
    expect(effectiveCourseRepo(empty, FIXTURE)).toBe(FIXTURE);
  });

  it("без кэша и без COURSE_REPO — null", () => {
    expect(effectiveCourseRepo("/nope/nope", null)).toBeNull();
  });
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/lib/config.test.ts`
Expected: FAIL — `effectiveCourseRepo is not a function`.

- [ ] **Step 3: Реализовать**

В `src/lib/config.ts` добавить в `Config` три поля и экспортировать хелпер:

```ts
export interface Config {
  sourceDir: string;
  courseRepo: string | null;
  /** Каталог кэш-клона рут-репозитория. Может ещё не существовать. */
  upstreamDir: string;
  upstreamRemote: string;
  upstreamBranch: string;
  contentDir: string;
  dataDir: string;
  agent: "claude" | "codex";
  /** Интерпретатор для pytest и замера. */
  python: string;
  /** Порт моста pyright-langserver. */
  lspPort: number;
}

const DEFAULT_UPSTREAM_REPO = "https://github.com/rohitg00/ai-engineering-from-scratch.git";

/**
 * Откуда брать материал курса: кэш-клон рут-репозитория, если он развернут,
 * иначе локальный COURSE_REPO.
 *
 * Кэш выигрывает не «потому что новее по времени», а потому что он ходит в
 * рут-репозиторий, а COURSE_REPO — это форк, который обновляют руками.
 */
export function effectiveCourseRepo(upstreamDir: string, courseRepo: string | null): string | null {
  if (isDirectory(path.join(upstreamDir, "phases"))) return upstreamDir;
  return courseRepo;
}
```

В теле `loadConfig` заменить возврат `courseRepo` на эффективный (комментарий про устаревший `COURSE_REPO` остаётся на месте, он всё ещё верен):

```ts
  const upstreamDir = path.join(root, ".cache", "course-repo");

  return {
    sourceDir: path.join(root, "source"),
    courseRepo: effectiveCourseRepo(upstreamDir, courseRepo),
    upstreamDir,
    upstreamRemote: env.UPSTREAM_REPO?.trim() || DEFAULT_UPSTREAM_REPO,
    upstreamBranch: env.UPSTREAM_BRANCH?.trim() || "main",
    contentDir: path.join(root, "content"),
    // ...остальное без изменений
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run src/lib/config.test.ts`
Expected: PASS. Существующие тесты («принимает существующий COURSE_REPO» и остальные) продолжают проходить, потому что каталога `.cache/course-repo` в репозитории нет.

- [ ] **Step 5: Дописать игнор и пример окружения**

В `.gitignore` после блока `/data` добавить:

```
# кэш-клон рут-репозитория курса
/.cache
```

В `.env.example` после строки `COURSE_REPO=...` добавить:

```
# Рут-репозиторий курса: отсюда кнопка импорта тянет свежую версию в .cache/course-repo
UPSTREAM_REPO=https://github.com/rohitg00/ai-engineering-from-scratch.git
UPSTREAM_BRANCH=main
```

- [ ] **Step 6: Прогнать весь набор**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add src/lib/config.ts src/lib/config.test.ts .gitignore .env.example
git commit -m "feat(config): prefer the upstream cache clone over COURSE_REPO"
```

---

### Task 3: Импорт с перезаписью

**Files:**
- Modify: `src/lib/source/import-lesson.ts`
- Modify: `src/lib/source/import-lesson.test.ts`
- Modify: `scripts/import-lesson.mjs` (только строки вывода — иначе скрипт печатает `undefined`)

**Interfaces:**
- Consumes: `LessonRef` из `./catalog`.
- Produces:
  - `interface ImportResult { slug: string; copied: string[]; updated: string[]; kept: string[] }` — поля `skipped` больше нет.
  - `interface ImportOptions { overwrite?: boolean }`
  - `function importLesson(courseRepo: string, sourceDir: string, ref: LessonRef, options?: ImportOptions): ImportResult`
  - `function isLearnerOwned(rel: string): boolean`
  - `function isImported(sourceDir: string, ref: LessonRef): boolean` — без изменений.

- [ ] **Step 1: Написать падающие тесты**

В `src/lib/source/import-lesson.test.ts` заменить существующий тест «не перетирает уже импортированные файлы» на набор ниже (импорт наверху файла становится `import { importLesson, isImported, isLearnerOwned } from "./import-lesson";`):

```ts
  it("без overwrite не перетирает уже импортированные файлы", () => {
    const sourceDir = tmp();
    importLesson(COURSE, sourceDir, beta());
    const mine = path.join(sourceDir, "phases/01-math-foundations/02-beta/docs/en.md");
    fs.writeFileSync(mine, "мой правленый текст", "utf8");

    const again = importLesson(COURSE, sourceDir, beta());
    expect(fs.readFileSync(mine, "utf8")).toBe("мой правленый текст");
    expect(again.copied).toEqual([]);
    expect(again.updated).toEqual([]);
    expect(again.kept.length).toBeGreaterThan(5);
  });

  it("с overwrite возвращает расходящийся файл к версии курса", () => {
    const sourceDir = tmp();
    importLesson(COURSE, sourceDir, beta());
    const rel = "phases/01-math-foundations/02-beta/docs/en.md";
    const mine = path.join(sourceDir, rel);
    fs.writeFileSync(mine, "устаревший текст", "utf8");

    const again = importLesson(COURSE, sourceDir, beta(), { overwrite: true });

    expect(fs.readFileSync(mine, "utf8")).toBe(fs.readFileSync(path.join(COURSE, rel), "utf8"));
    expect(again.updated).toContain(rel);
    expect(again.copied).toEqual([]);
  });

  // Единственный файл в наборе, который создаёт лаба и пишет учащийся.
  // Перезапись стёрла бы решение без возможности отката.
  //
  // Курс здесь собирается свой, а не берётся COURSE: в общей фикстуре
  // exercise.py нет, а класть его туда на время теста — значит показывать
  // чужой файл параллельно идущим тестам других файлов.
  it("с overwrite не трогает exercise.py учащегося", () => {
    const courseRepo = tmp();
    const ref = {
      slug: "01-solo__01-owned",
      phaseDir: "01-solo",
      lessonDir: "01-owned",
      phaseNumber: 1,
      lessonNumber: 1,
      title: "Owned",
    };
    const docs = path.join(courseRepo, "phases", ref.phaseDir, ref.lessonDir, "docs");
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, "en.md"), "текст урока", "utf8");
    const exercises = path.join(courseRepo, "learning-exercises", "p01-l01-owned");
    fs.mkdirSync(exercises, { recursive: true });
    fs.writeFileSync(path.join(exercises, "exercise.template.py"), "def solve():\n    pass\n", "utf8");
    fs.writeFileSync(path.join(exercises, "exercise.py"), "def solve():\n    pass\n", "utf8");

    const sourceDir = tmp();
    importLesson(courseRepo, sourceDir, ref);

    const rel = path.join("learning-exercises", "p01-l01-owned", "exercise.py");
    const mine = path.join(sourceDir, rel);
    fs.writeFileSync(mine, "def solve():\n    return 42\n", "utf8");

    const again = importLesson(courseRepo, sourceDir, ref, { overwrite: true });

    expect(fs.readFileSync(mine, "utf8")).toBe("def solve():\n    return 42\n");
    expect(again.updated).not.toContain(rel);
    expect(again.kept).toContain(rel);
  });

  it("совпавший байт-в-байт файл не считается обновлённым", () => {
    const sourceDir = tmp();
    importLesson(COURSE, sourceDir, beta());

    const again = importLesson(COURSE, sourceDir, beta(), { overwrite: true });

    expect(again.updated).toEqual([]);
    expect(again.copied).toEqual([]);
    expect(again.kept.length).toBeGreaterThan(5);
  });
```

И добавить отдельный блок в конец файла:

```ts
describe("isLearnerOwned", () => {
  it("узнаёт exercise.py учащегося и только его", () => {
    expect(isLearnerOwned("learning-exercises/p01-l02-beta/exercise.py")).toBe(true);
    expect(isLearnerOwned("learning-exercises/p01-l02-beta/exercise.template.py")).toBe(false);
    expect(isLearnerOwned("learning-exercises/p01-l02-beta/tests/exercise.py")).toBe(false);
    expect(isLearnerOwned("phases/01-math-foundations/02-beta/docs/exercise.py")).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/lib/source/import-lesson.test.ts`
Expected: FAIL — `isLearnerOwned is not a function`, плюс падения на `again.updated`.

- [ ] **Step 3: Реализовать**

В `src/lib/source/import-lesson.ts`:

```ts
export interface ImportResult {
  slug: string;
  /** Файлы, которых в source/ не было. */
  copied: string[];
  /** Файлы, перезаписанные версией из курса. */
  updated: string[];
  /** Файлы, оставленные как есть: защищённые или совпавшие байт-в-байт. */
  kept: string[];
}

export interface ImportOptions {
  overwrite?: boolean;
}

const LEARNER_OWNED = /^learning-exercises\/[^/]+\/exercise\.py$/;

/**
 * Файл, который принадлежит учащемуся, а не курсу.
 *
 * Правило явное, а не «сравним с шаблоном»: решение, случайно совпавшее с
 * заготовкой, всё равно остаётся работой учащегося, и отката у перезаписи нет.
 */
export function isLearnerOwned(rel: string): boolean {
  return LEARNER_OWNED.test(rel.split(path.sep).join("/"));
}

function sameContent(a: string, b: string): boolean {
  return fs.readFileSync(a).equals(fs.readFileSync(b));
}

function copyFile(
  courseRepo: string,
  sourceDir: string,
  abs: string,
  result: ImportResult,
  overwrite: boolean,
): void {
  const rel = path.relative(courseRepo, abs);
  const target = path.join(sourceDir, rel);

  if (fs.existsSync(target)) {
    if (!overwrite || isLearnerOwned(rel) || sameContent(abs, target)) {
      result.kept.push(rel);
      return;
    }
    fs.copyFileSync(abs, target);
    result.updated.push(rel);
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(abs, target);
  result.copied.push(rel);
}
```

`copyTree` получает параметр `overwrite` и передаёт его в `copyFile`. `importLesson` меняет сигнатуру и заводит результат с тремя списками:

```ts
export function importLesson(
  courseRepo: string,
  sourceDir: string,
  ref: LessonRef,
  options: ImportOptions = {},
): ImportResult {
  const overwrite = options.overwrite ?? false;
  const result: ImportResult = { slug: ref.slug, copied: [], updated: [], kept: [] };

  copyTree(courseRepo, sourceDir, path.join("phases", ref.phaseDir, ref.lessonDir), result, overwrite);
  copyTree(courseRepo, sourceDir, path.join("i18n", "ru", "phases", ref.phaseDir, ref.lessonDir), result, overwrite);
  // ...визуализации: copyFile(..., result, overwrite)
  // ...упражнение: copyTree(..., result, overwrite)

  return result;
}
```

- [ ] **Step 4: Починить вывод CLI**

В `scripts/import-lesson.mjs` заменить две последние строки вывода:

```js
console.log(
  `${slug}: создано ${result.copied.length}, обновлено ${result.updated.length}, оставлено ${result.kept.length}`,
);
for (const rel of result.copied) console.log(`  + ${rel}`);
for (const rel of result.updated) console.log(`  ~ ${rel}`);
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test && npm run typecheck`
Expected: PASS. Если `typecheck` ругается на `result.skipped` где-то ещё — это место тоже надо перевести на `kept`.

- [ ] **Step 6: Коммит**

```bash
git add src/lib/source/import-lesson.ts src/lib/source/import-lesson.test.ts scripts/import-lesson.mjs
git commit -m "feat(source): reimport a lesson over the files it already has"
```

---

### Task 4: Сборка запроса на импорт

**Files:**
- Create: `src/lib/source/import-request.ts`
- Test: `src/lib/source/import-request.test.ts`

**Interfaces:**
- Consumes: `ensureUpstream`/`UpstreamOptions`/`UpstreamResult` (Задача 1), `Config` (Задача 2), `importLesson`/`isImported` (Задача 3), `findLesson` из `./catalog`.
- Produces:
  - `interface ImportOutcome { slug: string; mode: "import" | "reimport"; pull: { fetched: boolean; head: string | null; at: number | null; error?: string }; copied: number; updated: number; kept: number }`
  - `interface ImportFailure { status: number; error: string }`
  - `type ImportRequestResult = ImportOutcome | ImportFailure`
  - `const UPSTREAM_MAX_AGE_MS = 5 * 60_000`
  - `function runImport(config: Config, slug: string, deps?: { ensure?: (options: UpstreamOptions) => UpstreamResult }): ImportRequestResult`

- [ ] **Step 1: Написать падающие тесты**

Create `src/lib/source/import-request.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Config } from "@/lib/config";
import { importLesson } from "./import-lesson";
import { findLesson } from "./catalog";
import { runImport, UPSTREAM_MAX_AGE_MS } from "./import-request";

const COURSE = path.resolve(__dirname, "../../../tests/fixtures/course");

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "request-"));
}

function config(overrides: Partial<Config> = {}): Config {
  return {
    sourceDir: tmp(),
    courseRepo: COURSE,
    upstreamDir: path.join(tmp(), "course-repo"),
    upstreamRemote: "https://example.invalid/course.git",
    upstreamBranch: "main",
    contentDir: tmp(),
    dataDir: tmp(),
    agent: "claude",
    python: "python3",
    lspPort: 3001,
    ...overrides,
  };
}

/** Апстрим «обновился» и лежит в фикстуре курса. */
const ensureOk = () => ({ dir: COURSE, head: "abc1234", fetched: true, fetchedAt: 1_000 });

describe("runImport", () => {
  it("на неизвестный урок отвечает 404", () => {
    const result = runImport(config(), "нет-такого-урока", { ensure: ensureOk });
    expect(result).toEqual({ status: 404, error: "Урок не найден" });
  });

  it("первый импорт идёт без перезаписи и отчитывается о новых файлах", () => {
    const cfg = config();
    const result = runImport(cfg, "01-math-foundations__02-beta", { ensure: ensureOk });

    expect("mode" in result && result.mode).toBe("import");
    expect("copied" in result && result.copied).toBeGreaterThan(0);
    expect("pull" in result && result.pull.head).toBe("abc1234");
  });

  // Режим выводится на сервере из состояния диска, а не приходит от клиента:
  // клиент не может попросить перезапись урока, который выглядит иначе, чем
  // на его экране.
  it("повторный импорт становится реимпортом сам", () => {
    const cfg = config();
    const ref = findLesson(COURSE, "01-math-foundations__02-beta")!;
    importLesson(COURSE, cfg.sourceDir, ref);
    const mine = path.join(cfg.sourceDir, "phases/01-math-foundations/02-beta/docs/en.md");
    fs.writeFileSync(mine, "устаревший текст", "utf8");

    const result = runImport(cfg, "01-math-foundations__02-beta", { ensure: ensureOk });

    expect("mode" in result && result.mode).toBe("reimport");
    expect("updated" in result && result.updated).toBeGreaterThan(0);
  });

  it("апстрим недоступен, но COURSE_REPO есть — импортирует и сообщает об ошибке пула", () => {
    const cfg = config();
    const ensure = () => {
      throw new Error("сеть недоступна");
    };

    const result = runImport(cfg, "01-math-foundations__02-beta", { ensure });

    expect("pull" in result && result.pull.error).toContain("сеть недоступна");
    expect("copied" in result && result.copied).toBeGreaterThan(0);
  });

  it("нет ни апстрима, ни COURSE_REPO — 503", () => {
    const cfg = config({ courseRepo: null });
    const ensure = () => {
      throw new Error("сеть недоступна");
    };

    const result = runImport(cfg, "01-math-foundations__02-beta", { ensure });

    expect("status" in result && result.status).toBe(503);
  });

  it("окно свежести кэша — пять минут", () => {
    expect(UPSTREAM_MAX_AGE_MS).toBe(5 * 60_000);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/lib/source/import-request.test.ts`
Expected: FAIL — `Failed to resolve import "./import-request"`.

- [ ] **Step 3: Реализовать**

Create `src/lib/source/import-request.ts`:

```ts
import type { Config } from "@/lib/config";
import { findLesson } from "./catalog";
import { importLesson, isImported } from "./import-lesson";
import { ensureUpstream, type UpstreamOptions, type UpstreamResult } from "./upstream";

/**
 * Сколько кэш апстрима считается свежим.
 *
 * Пять минут выбраны так, чтобы серия импортов подряд («завести четыре
 * урока») стоила одного обращения к сети, а возврат к каталогу через полчаса
 * гарантированно принёс свежий курс.
 */
export const UPSTREAM_MAX_AGE_MS = 5 * 60_000;

export interface ImportOutcome {
  slug: string;
  mode: "import" | "reimport";
  pull: { fetched: boolean; head: string | null; at: number | null; error?: string };
  copied: number;
  updated: number;
  kept: number;
}

export interface ImportFailure {
  status: number;
  error: string;
}

export type ImportRequestResult = ImportOutcome | ImportFailure;

export interface ImportDeps {
  ensure?: (options: UpstreamOptions) => UpstreamResult;
}

export function runImport(config: Config, slug: string, deps: ImportDeps = {}): ImportRequestResult {
  const ensure = deps.ensure ?? ensureUpstream;

  let repo = config.courseRepo;
  let pull: ImportOutcome["pull"] = { fetched: false, head: null, at: null };

  try {
    const upstream = ensure({
      dir: config.upstreamDir,
      remote: config.upstreamRemote,
      branch: config.upstreamBranch,
      maxAgeMs: UPSTREAM_MAX_AGE_MS,
    });
    repo = upstream.dir;
    pull = { fetched: upstream.fetched, head: upstream.head, at: upstream.fetchedAt, error: upstream.error };
  } catch (error) {
    // Апстрим не развернулся. Если локальный курс есть — импортируем из него
    // и говорим об этом; кнопка не обязана падать из-за отсутствия сети.
    pull = { ...pull, error: (error as Error).message };
  }

  if (!repo) {
    return { status: 503, error: "Курс недоступен: нет ни кэша апстрима, ни COURSE_REPO" };
  }

  const ref = findLesson(repo, slug);
  if (!ref) return { status: 404, error: "Урок не найден" };

  const overwrite = isImported(config.sourceDir, ref);
  const result = importLesson(repo, config.sourceDir, ref, { overwrite });

  return {
    slug,
    mode: overwrite ? "reimport" : "import",
    pull,
    copied: result.copied.length,
    updated: result.updated.length,
    kept: result.kept.length,
  };
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run src/lib/source/import-request.test.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/source/import-request.ts src/lib/source/import-request.test.ts
git commit -m "feat(source): pull upstream before importing a lesson by slug"
```

---

### Task 5: Роут импорта

**Files:**
- Create: `src/app/api/catalog/import/route.ts`
- Test: `src/app/api/catalog/import/route.test.ts`

**Interfaces:**
- Consumes: `loadConfig` (Задача 2), `runImport`/`ImportRequestResult` (Задача 4).
- Produces: `POST /api/catalog/import`, тело `{ slug: string }`, ответ `ImportOutcome` или `{ error }` со статусом 400/404/500/503.

- [ ] **Step 1: Написать падающие тесты**

Create `src/app/api/catalog/import/route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { POST } from "./route";

// Как и в остальных route-тестах проекта, проверяется ветка валидации тела:
// она отвечает до loadConfig() и до любого обращения к диску и сети. Выбор
// режима, откат на COURSE_REPO и коды 404/503 покрыты в
// src/lib/source/import-request.test.ts.
function makeRequest(body: string): Request {
  return new Request("http://localhost/api/catalog/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("POST /api/catalog/import — валидация", () => {
  it("без слага отвечает 400", async () => {
    const response = await POST(makeRequest(JSON.stringify({})));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("слаг");
  });

  it("на пустой слаг отвечает 400", async () => {
    const response = await POST(makeRequest(JSON.stringify({ slug: "   " })));
    expect(response.status).toBe(400);
  });

  it("на тело, которое не разбирается как JSON, отвечает 400, а не падает", async () => {
    const response = await POST(makeRequest("{не json"));
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/app/api/catalog/import/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 3: Реализовать**

Create `src/app/api/catalog/import/route.ts`:

```ts
import { loadConfig } from "@/lib/config";
import { runImport } from "@/lib/source/import-request";

interface Body {
  slug?: unknown;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) return Response.json({ error: "Не передан слаг урока" }, { status: 400 });

  try {
    const result = runImport(loadConfig(), slug);
    if ("status" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result);
  } catch (error) {
    // Сюда попадает, например, неоднозначный каталог упражнения из
    // findExerciseDir: это поломка данных курса, а не запроса.
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run src/app/api/catalog/import/route.test.ts`
Expected: PASS, 3 теста.

- [ ] **Step 5: Коммит**

```bash
git add src/app/api/catalog/import/route.ts src/app/api/catalog/import/route.test.ts
git commit -m "feat(api): add the lesson import endpoint"
```

---

### Task 6: Кнопка в каталоге

**Files:**
- Create: `src/components/ImportButton.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `POST /api/catalog/import` (Задача 5), `fetchJson` из `@/lib/api/fetch-json`, `isDirectory` из `@/lib/config`.
- Produces: `<ImportButton slug={string} imported={boolean} firstRun={boolean} />`.

- [ ] **Step 1: Написать компонент**

Create `src/components/ImportButton.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/api/fetch-json";

interface ImportResponse {
  mode: "import" | "reimport";
  pull: { fetched: boolean; head: string | null; error?: string };
  copied: number;
  updated: number;
  kept: number;
}

interface Props {
  slug: string;
  imported: boolean;
  /** Кэша апстрима ещё нет: первый клик клонирует курс целиком, это долго. */
  firstRun: boolean;
}

const RESULT_MS = 6000;

export default function ImportButton({ slug, imported, firstRun }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<ImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Итог гаснет сам: строка каталога — не место для постоянной сводки, а
  // ручного «закрыть» на ней быть не должно.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), RESULT_MS);
    return () => clearTimeout(timer);
  }, [done]);

  async function run() {
    setRunning(true);
    setError(null);
    setDone(null);

    const result = await fetchJson<ImportResponse>("/api/catalog/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug }),
    });

    setRunning(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(result.data);
    router.refresh();
  }

  if (running) {
    const label = firstRun ? "Клонирую курс…" : imported ? "Обновляю…" : "Импортирую…";
    return <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{label}</span>;
  }

  if (error) {
    return (
      <span className="ml-auto flex items-baseline gap-2 text-xs">
        <span className="text-red-600 dark:text-red-400">{error}</span>
        <button type="button" onClick={run} className="underline underline-offset-2">
          ещё раз
        </button>
      </span>
    );
  }

  if (done) {
    return (
      <span className="ml-auto flex items-baseline gap-2 text-xs text-slate-500 dark:text-slate-400">
        {done.pull.error && (
          <span className="text-amber-600 dark:text-amber-400">апстрим не опрошен, взято из кэша</span>
        )}
        <span>+{done.copied} новых, {done.updated} обновлено</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={run}
      className="ml-auto rounded px-2 py-0.5 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
    >
      {imported ? "Обновить" : "Импортировать"}
    </button>
  );
}
```

- [ ] **Step 2: Вставить кнопку в каталог**

В `src/app/page.tsx` добавить `import path from "node:path";` и `import ImportButton from "@/components/ImportButton";`, а существующую строку `import { loadConfig } from "@/lib/config";` расширить до:

```tsx
import { isDirectory, loadConfig } from "@/lib/config";
```

После `const readCounts = ...` добавить:

```tsx
  // Первый клик без кэша клонирует курс целиком — кнопке нужно сказать об
  // этом словами, иначе долгое молчание читается как зависание.
  const firstRun = !isDirectory(path.join(config.upstreamDir, ".git"));
```

Ветку неимпортированного урока заменить на (атрибут `title` с командой CLI убрать — кнопка делает то же самое):

```tsx
                return (
                  <li
                    key={lesson.slug}
                    className="flex items-baseline gap-2 px-2 py-1 text-slate-500 dark:text-slate-400"
                  >
                    <span className="tabular-nums">{lesson.lessonNumber}</span>
                    <span>{lesson.title}</span>
                    <ImportButton slug={lesson.slug} imported={false} firstRun={firstRun} />
                  </li>
                );
```

Ветку импортированного урока заменить на (кнопка снаружи `<Link>`: вложенный интерактивный элемент недопустим):

```tsx
              return (
                <li key={lesson.slug} className="flex items-baseline gap-2 pr-2">
                  <Link
                    href={`/lesson/${lesson.slug}`}
                    className="flex flex-1 items-baseline gap-2 rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <span className="tabular-nums text-slate-500 dark:text-slate-400">{lesson.lessonNumber}</span>
                    <span>{lesson.title}</span>
                    {plan && (
                      <span className="ml-auto text-xs text-emerald-600 dark:text-emerald-400">
                        {readCounts.get(lesson.slug) ?? 0} из {plan.steps.length} шагов
                      </span>
                    )}
                  </Link>
                  <ImportButton slug={lesson.slug} imported firstRun={firstRun} />
                </li>
              );
```

- [ ] **Step 3: Проверить сборку и типы**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Приёмка руками**

Run: `npm run dev`, открыть `http://localhost:3000`.

Проверить по порядку:
1. У неимпортированного урока вместо «не импортирован» стоит «Импортировать».
2. Первый клик показывает «Клонирую курс…»; после успеха строка становится ссылкой, справа — `+N новых, 0 обновлено`, через несколько секунд текст исчезает.
3. `ls .cache/course-repo/phases | head` показывает фазы курса; `git -C /Users/oleksandr/ai-engineering-from-scratch status --short` показывает ровно то же, что до клика (форк не тронут).
4. У импортированного урока есть «Обновить»; клик в пределах пяти минут не ходит в сеть (отрабатывает мгновенно) и даёт `+0 новых, 0 обновлено`.
5. Клик по названию урока по-прежнему открывает урок, а не срабатывает как кнопка.

- [ ] **Step 5: Коммит**

```bash
git add src/components/ImportButton.tsx src/app/page.tsx
git commit -m "feat(ui): import and reimport lessons from the catalog"
```

---

### Task 7: Флаг --force для CLI

**Files:**
- Modify: `scripts/import-lesson.mjs`

**Interfaces:**
- Consumes: `loadConfig` (Задача 2), `importLesson` с `{ overwrite }` (Задача 3).
- Produces: `npm run import -- <slug> [--force]`.

- [ ] **Step 1: Переписать разбор аргументов и выбор репозитория**

В `scripts/import-lesson.mjs` заменить блок от `const slug = process.argv[2];` до строки с `path.resolve(courseRepo)` на:

```js
const args = process.argv.slice(2);
const force = args.includes("--force");
const slug = args.find((arg) => !arg.startsWith("--"));
if (!slug) {
  console.error("Укажи слаг урока, например 01-math-foundations__02-beta [--force]");
  process.exit(2);
}

const load = async (rel) => import(pathToFileURL(path.resolve(rel)).href);
const { loadConfig } = await load("src/lib/config.ts");
const config = loadConfig();

// Приложение терпит отсутствие курса (чтение импортированных уроков от него
// не зависит), импортёру же импортировать неоткуда. Отказ здесь — суть.
if (!config.courseRepo) {
  console.error("Курс недоступен: нет ни .cache/course-repo, ни валидного COURSE_REPO");
  process.exit(2);
}
```

Дальше `findLesson`/`importLesson` берут `config.courseRepo` и `config.sourceDir`:

```js
const { findLesson } = await load("src/lib/source/catalog.ts");
const { importLesson } = await load("src/lib/source/import-lesson.ts");

const ref = findLesson(config.courseRepo, slug);
if (!ref) {
  console.error(`Урок ${slug} не найден в ${config.courseRepo}`);
  process.exit(1);
}

const result = importLesson(config.courseRepo, config.sourceDir, ref, { overwrite: force });
```

Импорты `fs` и проверка `resolvedRepo` из файла уходят — их работу делает `loadConfig`. Строки вывода из Задачи 3 остаются.

Скрипт в сеть не ходит: обновление апстрима — работа кнопки. CLI берёт тот же кэш, если он развернут, и не расходится с UI в источнике.

- [ ] **Step 2: Проверить оба режима**

Run:
```bash
npm run import -- 01-math-foundations__02-vectors-matrices-operations
npm run import -- 01-math-foundations__02-vectors-matrices-operations --force
git status --short source/
```
Expected: первый запуск — `создано 0, обновлено 0, оставлено N`; второй — то же самое (кэша апстрима может ещё не быть, тогда источник совпадает с `source/`). `git status --short source/` пуст: ничего не разошлось.

- [ ] **Step 3: Проверить отказ без курса**

Run: `COURSE_REPO=/nope npm run import -- 01-math-foundations__02-vectors-matrices-operations`
Expected: код выхода 2 и сообщение «Курс недоступен…», если `.cache/course-repo` ещё не развёрнут. Если кэш есть — импорт проходит, и это правильное поведение.

- [ ] **Step 4: Коммит**

```bash
git add scripts/import-lesson.mjs
git commit -m "feat(scripts): add --force and read the course repo from the config"
```

---

## Финальная проверка

- [ ] `npm test` — зелёный
- [ ] `npm run lint` — зелёный
- [ ] `npm run typecheck` — зелёный
- [ ] `git -C /Users/oleksandr/ai-engineering-from-scratch status --short` не изменился за всё время работы
- [ ] `git -C /Users/oleksandr/ai-engineering-from-scratch branch --show-current` по-прежнему `feat/practice-harness`
- [ ] `git status --short` в лабе не показывает `.cache/`
