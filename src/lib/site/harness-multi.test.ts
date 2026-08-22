import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HARNESS = path.join(process.cwd(), "src", "site-python", "harness.py");

function runMultiHarness(payload: Record<string, unknown>): Record<string, unknown> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "course-site-harness-multi-"));
  const script = [
    "import importlib.util, json, sys",
    `spec = importlib.util.spec_from_file_location('course_harness', ${JSON.stringify(HARNESS)})`,
    "harness = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(harness)",
    "request = json.loads(sys.stdin.read())",
    "report = harness._run_report_files(request['files'], request['tests'], request['testNodes'], sys.argv[1])",
    "print(json.dumps(report))",
  ].join("\n");

  try {
    const raw = execFileSync("python3", ["-c", script, dir], {
      encoding: "utf8",
      input: JSON.stringify(payload),
    });
    return JSON.parse(raw);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("браузерный Python-раннер многофайловой лаборатории", () => {
  it("пишет соседние модули и запускает точный unittest-метод", () => {
    const report = runMultiHarness({
      files: {
        "main.py": "from contract import LIMIT\n\nclass Budget:\n    def exceeded(self):\n        return LIMIT\n",
        "contract.py": "LIMIT = 'turns'\n",
      },
      tests: {
        "test_steps.py": [
          "import unittest",
          "from main import Budget",
          "class TestBudget(unittest.TestCase):",
          "    def test_exceeded(self):",
          "        self.assertEqual(Budget().exceeded(), 'turns')",
          "    def test_unrelated(self):",
          "        self.fail('не должен запускаться')",
        ].join("\n"),
      },
      testNodes: ["test_steps.py::TestBudget::test_exceeded"],
    });

    expect(report).toMatchObject({ loadError: null, filtered: true });
    expect(report.results).toEqual([
      expect.objectContaining({ name: "TestBudget.test_exceeded", passed: true }),
    ]);
  });

  it("проверяет настоящий Budget.exceeded лаборатории 20 через границу модулей", () => {
    const root = path.join(
      process.cwd(),
      "source/learning-exercises/p19-l20-agent-harness-loop-contract",
    );
    const tests = {
      "test_steps.py": fs.readFileSync(path.join(root, "test_steps.py"), "utf8"),
      "test_exercise.py": fs.readFileSync(path.join(root, "test_exercise.py"), "utf8"),
    };
    const payload = (half: "solution" | "exercise.template") => ({
      files: {
        "main.py": fs.readFileSync(path.join(root, half, "main.py"), "utf8"),
        "contract.py": fs.readFileSync(path.join(root, half, "contract.py"), "utf8"),
      },
      tests,
      testNodes: [
        "test_steps.py::TestStepContracts::test_budget_reports_each_limit_in_priority_order",
      ],
    });

    const solution = runMultiHarness(payload("solution"));
    const template = runMultiHarness(payload("exercise.template"));
    expect(solution).toMatchObject({
      loadError: null,
      results: [expect.objectContaining({ passed: true })],
    });
    expect(template).toMatchObject({
      loadError: null,
      results: [expect.objectContaining({ passed: false })],
    });
  });
});
