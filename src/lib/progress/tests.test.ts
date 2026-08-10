import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeProgressDb, openProgressDb } from "./db";
import { lastTestRun, recordTestRun } from "./tests";

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
    recordTestRun(db, "l1", "012-transpose", "transpose", { passed: 0, failed: 3, firstFailure: "E assert" }, "2026-08-10T10:00:00.000Z");
    recordTestRun(db, "l1", "012-transpose", "transpose", { passed: 3, failed: 0, firstFailure: null }, "2026-08-10T10:05:00.000Z");

    const last = lastTestRun(db, "l1", "012-transpose")!;
    expect(last).toMatchObject({ passed: 3, failed: 0, firstFailure: null, exerciseFn: "transpose" });
  });

  it("для шага без прогонов отдаёт null", () => {
    expect(lastTestRun(open(), "l1", "013-matmul")).toBeNull();
  });

  it("прогоны разных шагов не смешиваются", () => {
    const db = open();
    recordTestRun(db, "l1", "012-transpose", "transpose", { passed: 3, failed: 0, firstFailure: null });
    recordTestRun(db, "l1", "015-matmul", "matmul", { passed: 0, failed: 4, firstFailure: "E boom" });
    expect(lastTestRun(db, "l1", "012-transpose")!.passed).toBe(3);
    expect(lastTestRun(db, "l1", "015-matmul")!.failed).toBe(4);
  });
});
