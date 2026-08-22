import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deriveLabExercise } from "@/lib/generate/derive-lab-exercise";
import { runTests } from "./run-tests";

describe("внешние ресурсы лаборатории", () => {
  it("эталон читает вендорную таксономию вне исходного дерева фазы", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lab-resource-isolated-"));
    const phase = path.join(root, "19-projects");
    const code = path.join(phase, "83-consumer", "code");
    const provider = path.join(phase, "82-provider", "outputs");
    const exercise = path.join(root, "p19-l83-consumer");
    fs.mkdirSync(code, { recursive: true });
    fs.mkdirSync(provider, { recursive: true });
    fs.writeFileSync(path.join(provider, "taxonomy.json"), '{"name":"safe"}\n', "utf8");
    fs.writeFileSync(
      path.join(code, "main.py"),
      [
        "import json",
        "from pathlib import Path",
        "HERE = Path(__file__).parent",
        'ROOT = HERE / "_resources"',
        "if not ROOT.is_dir():",
        "    ROOT = HERE.parent.parent",
        "def load_taxonomy():",
        '    return json.loads((ROOT / "82-provider" / "outputs" / "taxonomy.json").read_text())',
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(code, "tests.py"),
      "from main import load_taxonomy\n\ndef test_taxonomy():\n    assert load_taxonomy() == {'name': 'safe'}\n",
      "utf8",
    );

    deriveLabExercise(code, exercise, {
      version: 1,
      authorTest: "tests.py",
      resources: [
        {
          source: "../../82-provider/outputs/taxonomy.json",
          target: "_resources/82-provider/outputs/taxonomy.json",
        },
      ],
      targets: [
        {
          file: "main.py",
          symbol: "load_taxonomy",
          instruction: "Прочитай таксономию.",
          tests: ["test_exercise.py"],
        },
      ],
    });

    const result = await runTests({
      dir: exercise,
      python: "python3",
      pythonPath: path.join(exercise, "solution"),
      testNodes: ["test_exercise.py"],
    });

    expect(result).toMatchObject({ failed: 0, errors: 0, passed: 1 });
  });
});
