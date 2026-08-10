import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeProgressDb, execute, openProgressDb, queryAll, queryOne } from "./db";

function tmpDataDir(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "progress-")), "data");
}

describe("openProgressDb", () => {
  it("создаёт директорию и файл базы", () => {
    const dataDir = tmpDataDir();
    openProgressDb(dataDir);
    expect(fs.existsSync(path.join(dataDir, "progress.db"))).toBe(true);
  });

  it("включает WAL и внешние ключи", () => {
    const db = openProgressDb(tmpDataDir());
    expect(queryOne<{ journal_mode: string }>(db, "PRAGMA journal_mode")?.journal_mode).toBe("wal");
    expect(queryOne<{ foreign_keys: number }>(db, "PRAGMA foreign_keys")?.foreign_keys).toBe(1);
  });

  it("создаёт все пять таблиц", () => {
    const db = openProgressDb(tmpDataDir());
    const names = queryAll<{ name: string }>(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).map((row) => row.name);

    expect(names).toContain("step_state");
    expect(names).toContain("quiz_attempts");
    expect(names).toContain("test_runs");
    expect(names).toContain("chat_sessions");
    expect(names).toContain("chat_messages");
  });

  it("повторное открытие отдаёт то же соединение и не теряет данные", () => {
    const dataDir = tmpDataDir();
    const first = openProgressDb(dataDir);
    execute(
      first,
      "INSERT INTO step_state (lesson_slug, step_id, state, opened_at) VALUES (?, ?, 'read', ?)",
      "slug",
      "001-t",
      "2026-08-10T09:00:00.000Z",
    );

    const second = openProgressDb(dataDir);
    expect(second).toBe(first);
    expect(queryAll<{ step_id: string }>(second, "SELECT step_id FROM step_state")).toHaveLength(1);
  });

  it("не даёт записать неизвестное состояние шага", () => {
    const db = openProgressDb(tmpDataDir());
    expect(() =>
      execute(
        db,
        "INSERT INTO step_state (lesson_slug, step_id, state) VALUES (?, ?, ?)",
        "slug",
        "001-t",
        "почти прочитан",
      ),
    ).toThrow(/CHECK/i);
  });

  it("переживает перезапуск: данные читаются после закрытия и повторного открытия того же файла", () => {
    const dataDir = tmpDataDir();

    const first = openProgressDb(dataDir);
    execute(
      first,
      "INSERT INTO step_state (lesson_slug, step_id, state, opened_at) VALUES (?, ?, 'passed', ?)",
      "phase-01/lesson-01",
      "003-quiz",
      "2026-08-10T09:00:00.000Z",
    );
    closeProgressDb(dataDir);

    // Новое соединение к тому же файлу — имитация перезапуска процесса
    // (например, следующего `npm run dev`). Кэш соединений по этому пути
    // уже пуст, так что чтение идёт с диска, а не из старого объекта.
    const reopened = openProgressDb(dataDir);
    // Сравниваем через булево значение, а не expect(reopened).not.toBe(first):
    // toBe при несовпадении объектов сам пробует глубокое сравнение (чтобы
    // подсказать toEqual/toStrictEqual), а оно трогает геттеры уже закрытого
    // node:sqlite соединения и бросает "database is not open" ещё до того,
    // как дойдёт до самой проверки.
    expect(reopened === first).toBe(false);

    const rows = queryAll<{ lesson_slug: string; step_id: string; state: string }>(
      reopened,
      "SELECT lesson_slug, step_id, state FROM step_state WHERE step_id = ?",
      "003-quiz",
    );
    expect(rows).toEqual([
      { lesson_slug: "phase-01/lesson-01", step_id: "003-quiz", state: "passed" },
    ]);
  });
});
