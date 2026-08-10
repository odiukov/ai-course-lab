import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { closeProgressDb, openProgressDb, queryAll, SCHEMA } from "./db";
import { lastTestRun, recordTestRun, type TestRunOutcome } from "./tests";

const filteredGreen: TestRunOutcome = {
  passed: 3,
  failed: 0,
  firstFailure: null,
  filtered: true,
  warning: null,
};

let dataDir = "";

function open() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-runs-"));
  return openProgressDb(dataDir);
}

afterEach(() => {
  if (dataDir) closeProgressDb(dataDir);
});

describe("recordTestRun / lastTestRun", () => {
  it("хранит прогоны и отдаёт последний", () => {
    const db = open();
    recordTestRun(
      db,
      "l1",
      "012-transpose",
      "transpose",
      { ...filteredGreen, passed: 0, failed: 3, firstFailure: "E assert" },
      "2026-08-10T10:00:00.000Z",
    );
    recordTestRun(db, "l1", "012-transpose", "transpose", filteredGreen, "2026-08-10T10:05:00.000Z");

    const last = lastTestRun(db, "l1", "012-transpose")!;
    expect(last).toMatchObject({ passed: 3, failed: 0, firstFailure: null, exerciseFn: "transpose" });
  });

  it("для шага без прогонов отдаёт null", () => {
    expect(lastTestRun(open(), "l1", "013-matmul")).toBeNull();
  });

  it("прогоны разных шагов не смешиваются", () => {
    const db = open();
    recordTestRun(db, "l1", "012-transpose", "transpose", filteredGreen);
    recordTestRun(db, "l1", "015-matmul", "matmul", {
      ...filteredGreen,
      passed: 0,
      failed: 4,
      firstFailure: "E boom",
    });
    expect(lastTestRun(db, "l1", "012-transpose")!.passed).toBe(3);
    expect(lastTestRun(db, "l1", "015-matmul")!.failed).toBe(4);
  });

  // Разбор кода читает именно эти два поля, чтобы не рассказывать агенту о
  // покрытии, которого не было.
  it("охват прогона и предупреждение доезжают до записи", () => {
    const db = open();
    recordTestRun(db, "l1", "025-is-symmetric", "is_symmetric", {
      passed: 17,
      failed: 0,
      firstFailure: null,
      filtered: false,
      warning: "Фильтр -k is_symmetric не выбрал ни одного теста — прогнан весь файл.",
    });
    const last = lastTestRun(db, "l1", "025-is-symmetric")!;
    expect(last.filtered).toBe(false);
    expect(last.warning).toContain("не выбрал ни одного теста");
  });

  it("отфильтрованный прогон помечен filtered = true", () => {
    const db = open();
    recordTestRun(db, "l1", "011-transpose", "transpose", filteredGreen);
    expect(lastTestRun(db, "l1", "011-transpose")!.filtered).toBe(true);
    expect(lastTestRun(db, "l1", "011-transpose")!.warning).toBeNull();
  });
});

// База учащегося уже существует на диске, и CREATE TABLE IF NOT EXISTS её не
// меняет: без миграции запись прогона падала бы на «no such column: filtered».
describe("миграция test_runs на существующей базе", () => {
  it("добавляет filtered и warning к таблице старой формы", () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-migrate-"));
    const old = SCHEMA.replace(
      /  filtered {6}INTEGER NOT NULL DEFAULT 1 CHECK \(filtered IN \(0, 1\)\),\n  warning {7}TEXT,\n/,
      "",
    );
    expect(old).not.toContain("filtered");

    // Старая база: та же схема, но без двух новых колонок.
    const legacy = new DatabaseSync(path.join(dataDir, "progress.db"));
    legacy.exec(old);
    legacy.exec(
      `INSERT INTO test_runs (lesson_slug, step_id, exercise_fn, passed, failed, first_failure, created_at)
       VALUES ('l1', '011-transpose', 'transpose', 3, 0, NULL, '2026-08-01T00:00:00.000Z')`,
    );
    legacy.close();

    const db = openProgressDb(dataDir);
    const columns = queryAll<{ name: string }>(db, "PRAGMA table_info(test_runs)").map((r) => r.name);
    expect(columns).toContain("filtered");
    expect(columns).toContain("warning");

    // Прогон, записанный до миграции, читается как «гонялся набор функции»
    // без предупреждения — ровно то, чем он и был.
    const last = lastTestRun(db, "l1", "011-transpose")!;
    expect(last).toMatchObject({ passed: 3, filtered: true, warning: null });

    // Повторное открытие уже миграцию не повторяет и не падает.
    closeProgressDb(dataDir);
    expect(lastTestRun(openProgressDb(dataDir), "l1", "011-transpose")!.filtered).toBe(true);
  });
});
