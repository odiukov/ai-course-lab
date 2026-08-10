import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeProgressDb, openProgressDb } from "./db";
import { readLatestAttempts, recordQuizAttempt } from "./quiz";

let dataDir = "";

function open() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-quiz-"));
  return openProgressDb(dataDir);
}

afterEach(() => {
  if (dataDir) closeProgressDb(dataDir);
});

describe("recordQuizAttempt / readLatestAttempts", () => {
  it("по каждому вопросу остаётся последний ответ", () => {
    const db = open();
    recordQuizAttempt(db, "l1", "005-check", 0, 1, false);
    recordQuizAttempt(db, "l1", "005-check", 0, 2, true);
    recordQuizAttempt(db, "l1", "005-check", 1, 0, true);

    const latest = readLatestAttempts(db, "l1", "005-check");
    expect(latest.get(0)).toMatchObject({ answerIndex: 2, correct: true });
    expect(latest.get(1)).toMatchObject({ answerIndex: 0, correct: true });
  });

  it("история сохраняется целиком, а не перетирается", () => {
    const db = open();
    recordQuizAttempt(db, "l1", "005-check", 0, 1, false);
    recordQuizAttempt(db, "l1", "005-check", 0, 2, true);
    const rows = db.prepare("SELECT COUNT(*) AS n FROM quiz_attempts").get() as { n: number };
    expect(Number(rows.n)).toBe(2);
  });

  it("попытки разных шагов не смешиваются", () => {
    const db = open();
    recordQuizAttempt(db, "l1", "005-check", 0, 1, true);
    recordQuizAttempt(db, "l1", "033-quiz", 0, 0, false);
    expect(readLatestAttempts(db, "l1", "033-quiz").get(0)!.correct).toBe(false);
  });
});
