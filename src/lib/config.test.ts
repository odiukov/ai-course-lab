import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadConfig } from "./config";

const FIXTURE = path.resolve(__dirname, "../../tests/fixtures/course");

describe("loadConfig", () => {
  it("падает, если COURSE_REPO не задан", () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/COURSE_REPO/);
  });

  it("падает, если COURSE_REPO указывает не на директорию", () => {
    expect(() => loadConfig({ COURSE_REPO: "/nope/nope" } as NodeJS.ProcessEnv))
      .toThrow(/не найдена/);
  });

  it("отдаёт абсолютные пути и агента по умолчанию", () => {
    const cfg = loadConfig({ COURSE_REPO: FIXTURE } as NodeJS.ProcessEnv);
    expect(cfg.courseRepo).toBe(FIXTURE);
    expect(cfg.agent).toBe("claude");
    expect(path.isAbsolute(cfg.contentDir)).toBe(true);
  });

  it("уважает AGENT=codex", () => {
    const cfg = loadConfig({ COURSE_REPO: FIXTURE, AGENT: "codex" } as NodeJS.ProcessEnv);
    expect(cfg.agent).toBe("codex");
  });
});
