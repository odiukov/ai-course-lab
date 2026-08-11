import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { effectiveCourseRepo, loadConfig } from "./config";

const FIXTURE = path.resolve(__dirname, "../../tests/fixtures/course");

describe("loadConfig", () => {
  it("работает без COURSE_REPO — импорт просто недоступен", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "config-"));
    const cfg = loadConfig({} as NodeJS.ProcessEnv, tempRoot);
    expect(cfg.courseRepo).toBeNull();
    expect(cfg.localCourseRepo).toBeNull();
    expect(path.isAbsolute(cfg.sourceDir)).toBe(true);
    expect(cfg.sourceDir.endsWith("source")).toBe(true);
  });

  // Изменено осознанно: раньше здесь ожидался throw. Спека обещает, что
  // чтение уже импортированных уроков не зависит от старого репозитория, а
  // loadConfig зовётся на каждом читающем маршруте — переехавший каталог
  // ронял всё приложение целиком. Отказ остался там, где он уместен: в
  // scripts/import-lesson.mjs.
  it("не падает, если COURSE_REPO переехал — импорт просто становится недоступен", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "config-"));
    const cfg = loadConfig({ NODE_ENV: "test", COURSE_REPO: "/nope/nope" } as NodeJS.ProcessEnv, tempRoot);
    expect(cfg.courseRepo).toBeNull();
    expect(cfg.localCourseRepo).toBeNull();
    expect(cfg.sourceDir.endsWith("source")).toBe(true);
  });

  it("не принимает файл вместо директории", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "config-"));
    const file = path.join(FIXTURE, "phases/01-math-foundations/01-alpha/docs/en.md");
    const cfg = loadConfig({ NODE_ENV: "test", COURSE_REPO: file } as NodeJS.ProcessEnv, tempRoot);
    expect(cfg.courseRepo).toBeNull();
    expect(cfg.localCourseRepo).toBeNull();
  });

  it("принимает существующий COURSE_REPO", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "config-"));
    const cfg = loadConfig({ NODE_ENV: "test", COURSE_REPO: FIXTURE } as NodeJS.ProcessEnv, tempRoot);
    expect(cfg.courseRepo).toBe(FIXTURE);
  });

  it("кэш выигрывает у COURSE_REPO: loadConfig возвращает его, даже когда COURSE_REPO существует", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "config-"));
    const cacheDir = path.join(tempRoot, ".cache", "course-repo");
    fs.mkdirSync(path.join(cacheDir, "phases"), { recursive: true });
    const cfg = loadConfig({ NODE_ENV: "test", COURSE_REPO: FIXTURE } as NodeJS.ProcessEnv, tempRoot);
    expect(cfg.courseRepo).toBe(cacheDir);
    // localCourseRepo не схлопывается кэшем — иначе runImport, откатываясь
    // на него после переструктурирования апстрима, откатывался бы на тот же кэш.
    expect(cfg.localCourseRepo).toBe(FIXTURE);
  });

  it("агент по умолчанию claude, AGENT=codex переключает", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "config-"));
    expect(loadConfig({} as NodeJS.ProcessEnv, tempRoot).agent).toBe("claude");
    expect(loadConfig({ NODE_ENV: "test", AGENT: "codex" } as NodeJS.ProcessEnv, tempRoot).agent).toBe(
      "codex",
    );
  });

  it("python и lspPort берутся из окружения с разумными значениями по умолчанию", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "config-"));
    expect(loadConfig({} as NodeJS.ProcessEnv, tempRoot).python).toBe("python3");
    expect(loadConfig({} as NodeJS.ProcessEnv, tempRoot).lspPort).toBe(3001);
    expect(
      loadConfig({ NODE_ENV: "test", PYTHON: " /usr/bin/python3.12 " } as NodeJS.ProcessEnv, tempRoot)
        .python,
    ).toBe("/usr/bin/python3.12");
    expect(loadConfig({ NODE_ENV: "test", LSP_PORT: "4010" } as NodeJS.ProcessEnv, tempRoot).lspPort).toBe(
      4010,
    );
    // Мусор в LSP_PORT не должен превращаться в NaN и рушить мост на старте.
    expect(loadConfig({ NODE_ENV: "test", LSP_PORT: "порт" } as NodeJS.ProcessEnv, tempRoot).lspPort).toBe(
      3001,
    );
  });

  it("апстрим по умолчанию — рут-репозиторий и ветка main", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "config-"));
    const cfg = loadConfig({} as NodeJS.ProcessEnv, tempRoot);
    expect(cfg.upstreamRemote).toBe("https://github.com/rohitg00/ai-engineering-from-scratch.git");
    expect(cfg.upstreamBranch).toBe("main");
    expect(cfg.upstreamDir.endsWith(path.join(".cache", "course-repo"))).toBe(true);
  });

  it("UPSTREAM_REPO и UPSTREAM_BRANCH переопределяют апстрим", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "config-"));
    const cfg = loadConfig({
      NODE_ENV: "test",
      UPSTREAM_REPO: "https://example.invalid/fork.git",
      UPSTREAM_BRANCH: "trunk",
    } as NodeJS.ProcessEnv, tempRoot);
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
});
