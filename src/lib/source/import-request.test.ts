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
