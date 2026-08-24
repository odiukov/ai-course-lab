import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HARNESS = path.join(process.cwd(), "src", "site-python", "harness.py");

function runHarness(code: string, test: string): Record<string, unknown> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "course-site-harness-"));
  fs.writeFileSync(path.join(dir, "test_exercise.py"), test, "utf8");

  const script = [
    "import importlib.util, json, sys",
    `spec = importlib.util.spec_from_file_location('course_harness', ${JSON.stringify(HARNESS)})`,
    "harness = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(harness)",
    "print(harness.run(sys.stdin.read(), None, [], sys.argv[1]))",
  ].join("\n");

  try {
    const raw = execFileSync("python3", ["-c", script, dir], {
      encoding: "utf8",
      input: code,
    });
    return JSON.parse(raw);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("браузерный Python-раннер", () => {
  it("возвращает print и stderr вместе с результатами тестов", () => {
    const report = runHarness(
      [
        "import sys",
        "print('модуль загружен')",
        "def answer():",
        "    print('answer вызвана')",
        "    print('диагностика', file=sys.stderr)",
        "    return 42",
      ].join("\n"),
      [
        "from exercise import answer",
        "def test_answer():",
        "    assert answer() == 42",
      ].join("\n"),
    );

    expect(report).toMatchObject({ loadError: null, filtered: true });
    expect(report.output).toBe("модуль загружен\nanswer вызвана\nдиагностика\n");
  });

  it("не теряет вывод, напечатанный до падения теста", () => {
    const report = runHarness(
      "def answer():\n    print('перед падением')\n    return 0\n",
      "from exercise import answer\ndef test_answer():\n    assert answer() == 42\n",
    );

    expect(report.output).toBe("перед падением\n");
    expect(report.results).toEqual([
      expect.objectContaining({ name: "test_answer", passed: false }),
    ]);
  });

});
