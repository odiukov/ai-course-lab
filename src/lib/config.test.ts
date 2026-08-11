import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { effectiveCourseRepo, loadConfig } from "./config";

const FIXTURE = path.resolve(__dirname, "../../tests/fixtures/course");

describe("loadConfig", () => {
  it("работает без COURSE_REPO — импорт просто недоступен", () => {
    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    expect(cfg.courseRepo).toBeNull();
    expect(path.isAbsolute(cfg.sourceDir)).toBe(true);
    expect(cfg.sourceDir.endsWith("source")).toBe(true);
  });

  // Изменено осознанно: раньше здесь ожидался throw. Спека обещает, что
  // чтение уже импортированных уроков не зависит от старого репозитория, а
  // loadConfig зовётся на каждом читающем маршруте — переехавший каталог
  // ронял всё приложение целиком. Отказ остался там, где он уместен: в
  // scripts/import-lesson.mjs.
  it("не падает, если COURSE_REPO переехал — импорт просто становится недоступен", () => {
    const cfg = loadConfig({ NODE_ENV: "test", COURSE_REPO: "/nope/nope" } as NodeJS.ProcessEnv);
    expect(cfg.courseRepo).toBeNull();
    expect(cfg.sourceDir.endsWith("source")).toBe(true);
  });

  it("не принимает файл вместо директории", () => {
    const file = path.join(FIXTURE, "phases/01-math-foundations/01-alpha/docs/en.md");
    expect(
      loadConfig({ NODE_ENV: "test", COURSE_REPO: file } as NodeJS.ProcessEnv).courseRepo,
    ).toBeNull();
  });

  it("принимает существующий COURSE_REPO", () => {
    const cfg = loadConfig({ NODE_ENV: "test", COURSE_REPO: FIXTURE } as NodeJS.ProcessEnv);
    expect(cfg.courseRepo).toBe(FIXTURE);
  });

  it("агент по умолчанию claude, AGENT=codex переключает", () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).agent).toBe("claude");
    expect(loadConfig({ NODE_ENV: "test", AGENT: "codex" } as NodeJS.ProcessEnv).agent).toBe(
      "codex",
    );
  });

  it("python и lspPort берутся из окружения с разумными значениями по умолчанию", () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).python).toBe("python3");
    expect(loadConfig({} as NodeJS.ProcessEnv).lspPort).toBe(3001);
    expect(
      loadConfig({ NODE_ENV: "test", PYTHON: " /usr/bin/python3.12 " } as NodeJS.ProcessEnv)
        .python,
    ).toBe("/usr/bin/python3.12");
    expect(loadConfig({ NODE_ENV: "test", LSP_PORT: "4010" } as NodeJS.ProcessEnv).lspPort).toBe(
      4010,
    );
    // Мусор в LSP_PORT не должен превращаться в NaN и рушить мост на старте.
    expect(loadConfig({ NODE_ENV: "test", LSP_PORT: "порт" } as NodeJS.ProcessEnv).lspPort).toBe(
      3001,
    );
  });

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
});
