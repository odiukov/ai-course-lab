import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PracticeError } from "./errors";
import { runTests } from "./run-tests";

const FAKE = path.join(process.cwd(), "tests/fixtures/practice/fake-python.mjs");

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-tests-"));
  fs.writeFileSync(path.join(dir, "test_exercise.py"), "# заглушка\n", "utf8");
  return dir;
}

afterEach(() => {
  delete process.env.FAKE_PYTHON_MODE;
});

describe("runTests", () => {
  it("зелёный прогон: считает пройденные и не выдумывает предупреждений", async () => {
    const result = await runTests({ dir: makeDir(), fn: "transpose", python: FAKE });
    expect(result).toMatchObject({ total: 2, passed: 2, failed: 0, filtered: true, warning: null });
    expect(result.command).toContain("-k transpose");
  });

  it("красный прогон: отдаёт первый упавший с решающей строкой", async () => {
    process.env.FAKE_PYTHON_MODE = "red";
    const result = await runTests({ dir: makeDir(), fn: "transpose", python: FAKE });
    expect(result.failed).toBe(1);
    expect(result.failures[0].name).toBe("test_transpose_twice_returns_original");
    expect(result.failures[0].decisive).toContain("assert 0 == 32");
  });

  it("если -k не дал тестов, гоняет весь файл и предупреждает", async () => {
    process.env.FAKE_PYTHON_MODE = "empty-filter";
    const result = await runTests({ dir: makeDir(), fn: "nosuch", python: FAKE });
    expect(result.total).toBe(2);
    expect(result.filtered).toBe(false);
    expect(result.warning).toContain("nosuch");
  });

  it("интерпретатор без pytest — это PracticeError, а не пустой прогон", async () => {
    process.env.FAKE_PYTHON_MODE = "missing-pytest";
    await expect(runTests({ dir: makeDir(), python: FAKE })).rejects.toMatchObject({
      name: "PracticeError",
      kind: "python",
    });
  });

  it("несуществующий интерпретатор даёт kind spawn", async () => {
    await expect(
      runTests({ dir: makeDir(), python: path.join(os.tmpdir(), "no-such-python") }),
    ).rejects.toMatchObject({ kind: "spawn" });
  });

  it("зависший прогон убивается по таймауту", async () => {
    process.env.FAKE_PYTHON_MODE = "hang";
    await expect(
      runTests({ dir: makeDir(), python: FAKE, timeoutMs: 300 }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("PracticeError несёт человеческое сообщение по-русски", async () => {
    process.env.FAKE_PYTHON_MODE = "missing-pytest";
    const error = await runTests({ dir: makeDir(), python: FAKE }).catch((e) => e as PracticeError);
    expect(error.message).toMatch(/pytest/i);
  });
});
