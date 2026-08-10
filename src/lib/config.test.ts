import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadConfig } from "./config";

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
});
