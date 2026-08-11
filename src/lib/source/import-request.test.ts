import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Config } from "@/lib/config";
import type { UpstreamOptions, UpstreamResult } from "./upstream";
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
const ensureOk = (): UpstreamResult => ({ dir: COURSE, head: "abc1234", fetched: true, fetchedAt: 1_000 });

/**
 * Оборачивает стаб `ensure`, чтобы тест видел опции, с которыми его позвали —
 * так регрессия «в git попал courseRepo, а не upstreamDir» не пройдёт мимо.
 */
function capturing(ensure: (options: UpstreamOptions) => UpstreamResult) {
  const calls: UpstreamOptions[] = [];
  const spy = (options: UpstreamOptions) => {
    calls.push(options);
    return ensure(options);
  };
  return { spy, calls };
}

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

  // Единственное, что мешает git разнести грязное рабочее дерево форка
  // пользователя, — это то, что ensureUpstream всегда получает upstreamDir, а
  // не courseRepo. Стаб ensureOk аргумент игнорировал — проверим явно.
  it("в git уходит upstreamDir конфига, а не courseRepo", () => {
    const cfg = config();
    const { spy, calls } = capturing(ensureOk);

    runImport(cfg, "01-math-foundations__02-beta", { ensure: spy });

    expect(calls).toHaveLength(1);
    expect(calls[0].dir).toBe(cfg.upstreamDir);
    expect(calls[0].remote).toBe(cfg.upstreamRemote);
    expect(calls[0].branch).toBe(cfg.upstreamBranch);
  });

  // ensureUpstream может отработать без ошибки и всё же не отдать курс:
  // не тот UPSTREAM_BRANCH, переструктуренный апстрим. loadConfig в этом
  // случае падает на COURSE_REPO — runImport должен вести себя так же.
  it("клон без phases/ — импорт идёт из COURSE_REPO, а не 404", () => {
    const cfg = config();
    const emptyDir = tmp();
    const ensure = () => ({ dir: emptyDir, head: "abc1234", fetched: true, fetchedAt: 1_000 });

    const result = runImport(cfg, "01-math-foundations__02-beta", { ensure });

    expect("status" in result).toBe(false);
    expect("mode" in result && result.mode).toBe("import");
    expect("copied" in result && result.copied).toBeGreaterThan(0);
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

  it("нет ни апстрима, ни COURSE_REPO — 503 с причиной падения клона", () => {
    const cfg = config({ courseRepo: null });
    const ensure = () => {
      throw new Error("Repository not found");
    };

    const result = runImport(cfg, "01-math-foundations__02-beta", { ensure });

    expect("status" in result && result.status).toBe(503);
    expect("error" in result && result.error).toContain("Repository not found");
  });

  it("окно свежести кэша — пять минут", () => {
    expect(UPSTREAM_MAX_AGE_MS).toBe(5 * 60_000);
  });
});
