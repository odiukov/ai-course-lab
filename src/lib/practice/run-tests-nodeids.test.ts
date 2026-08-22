import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runTests } from "./run-tests";

describe("runTests — точные pytest node IDs", () => {
  it("запускает один unittest-метод без эвристики -k", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-nodeids-"));
    fs.writeFileSync(
      path.join(dir, "test_exercise.py"),
      [
        "import unittest",
        "",
        "class TestLoop(unittest.TestCase):",
        "    def test_first(self):",
        "        self.assertTrue(True)",
        "",
        "    def test_second(self):",
        "        self.assertTrue(True)",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runTests({
      dir,
      python: "python3",
      testNodes: ["test_exercise.py::TestLoop::test_second"],
    });

    expect(result).toMatchObject({
      total: 1,
      passed: 1,
      failed: 0,
      filtered: true,
      warning: null,
    });
    expect(result.command).toContain("test_exercise.py::TestLoop::test_second");
    expect(result.command).not.toContain(" -k ");
  });

  it("может назначить цели весь авторский файл как финальный suite", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-nodeids-full-"));
    fs.writeFileSync(
      path.join(dir, "test_exercise.py"),
      "def test_one():\n    assert True\n\ndef test_two():\n    assert True\n",
      "utf8",
    );

    const result = await runTests({ dir, python: "python3", testNodes: ["test_exercise.py"] });
    expect(result).toMatchObject({ total: 2, passed: 2, filtered: true, warning: null });
  });
});
