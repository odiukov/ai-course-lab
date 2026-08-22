import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deriveLabExercise, type LabExerciseSpec } from "./derive-lab-exercise";
import { verifyDerivedLabExercise } from "./verify-lab-exercise";

function fixture(testBody: string): { exercise: string; spec: LabExerciseSpec } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lab-verify-"));
  const code = path.join(root, "code");
  const exercise = path.join(root, "exercise");
  fs.mkdirSync(code, { recursive: true });
  fs.writeFileSync(path.join(code, "main.py"), "def answer():\n    return 42\n", "utf8");
  fs.writeFileSync(path.join(code, "test_main.py"), testBody, "utf8");
  const spec: LabExerciseSpec = {
    version: 1,
    authorTest: "test_main.py",
    targets: [
      {
        file: "main.py",
        symbol: "answer",
        instruction: "Верни ответ.",
        tests: ["test_exercise.py::test_answer"],
      },
    ],
  };
  deriveLabExercise(code, exercise, spec);
  return { exercise, spec };
}

describe("verifyDerivedLabExercise", () => {
  it("принимает зелёный эталон и красную заглушку", async () => {
    const { exercise, spec } = fixture(
      "from main import answer\n\ndef test_answer():\n    assert answer() == 42\n",
    );
    await expect(verifyDerivedLabExercise(exercise, spec)).resolves.toBeUndefined();
  });

  it("отклоняет тест, который не доходит до вырезанного шва", async () => {
    const { exercise, spec } = fixture("def test_answer():\n    assert 40 + 2 == 42\n");
    await expect(verifyDerivedLabExercise(exercise, spec)).rejects.toThrow(/осталась зелёной/);
  });
});
