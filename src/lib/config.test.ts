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

  it("падает, если COURSE_REPO указывает не на директорию", () => {
    expect(() => loadConfig({ COURSE_REPO: "/nope/nope" } as NodeJS.ProcessEnv))
      .toThrow(/не найдена/);
  });

  it("принимает существующий COURSE_REPO", () => {
    const cfg = loadConfig({ COURSE_REPO: FIXTURE } as NodeJS.ProcessEnv);
    expect(cfg.courseRepo).toBe(FIXTURE);
  });

  it("агент по умолчанию claude, AGENT=codex переключает", () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).agent).toBe("claude");
    expect(loadConfig({ AGENT: "codex" } as NodeJS.ProcessEnv).agent).toBe("codex");
  });
});
