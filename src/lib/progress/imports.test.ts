import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeProgressDb, openProgressDb } from "./db";
import { lastImportAt, readImportDates, recordImport } from "./imports";

let dataDir = "";

function open() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-imports-"));
  return openProgressDb(dataDir);
}

afterEach(() => {
  if (dataDir) closeProgressDb(dataDir);
});

describe("recordImport / lastImportAt", () => {
  it("до первого импорта даты нет", () => {
    expect(lastImportAt(open(), "l1")).toBeNull();
  });

  it("запоминает момент импорта", () => {
    const db = open();
    recordImport(db, "l1", new Date("2026-08-11T10:00:00.000Z"));
    expect(lastImportAt(db, "l1")).toBe("2026-08-11T10:00:00.000Z");
  });

  // Дата — «когда в последний раз», а не «когда впервые»: строка каталога
  // отвечает на вопрос «насколько свежий у меня урок».
  it("повторный импорт сдвигает дату, а не добавляет строку", () => {
    const db = open();
    recordImport(db, "l1", new Date("2026-08-11T10:00:00.000Z"));
    recordImport(db, "l1", new Date("2026-08-12T09:00:00.000Z"));
    expect(lastImportAt(db, "l1")).toBe("2026-08-12T09:00:00.000Z");
    expect(readImportDates(db).size).toBe(1);
  });

  it("уроки не путаются между собой", () => {
    const db = open();
    recordImport(db, "l1", new Date("2026-08-11T10:00:00.000Z"));
    recordImport(db, "l2", new Date("2026-08-12T10:00:00.000Z"));
    const dates = readImportDates(db);
    expect(dates.get("l1")).toBe("2026-08-11T10:00:00.000Z");
    expect(dates.get("l2")).toBe("2026-08-12T10:00:00.000Z");
  });
});
