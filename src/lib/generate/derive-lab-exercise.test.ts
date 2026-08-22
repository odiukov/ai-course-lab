import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deriveLabExercise, stubExerciseTarget } from "./derive-lab-exercise";

describe("stubExerciseTarget", () => {
  it("сохраняет многострочную сигнатуру метода и заменяет только тело", () => {
    const source = [
      "class Loop:",
      "    async def resume(",
      "        self, payload: dict",
      "    ) -> dict:",
      "        value = payload.copy()",
      "        return value",
      "",
      "    def untouched(self):",
      "        return 1",
    ].join("\n");

    const template = stubExerciseTarget(source, "Loop.resume", "Верни продолжение цикла.");
    expect(template).toContain("    ) -> dict:\n        \"\"\"Верни продолжение цикла.\"\"\"");
    expect(template).toContain("        raise NotImplementedError");
    expect(template).toContain("    def untouched(self):\n        return 1");
  });
});

describe("deriveLabExercise", () => {
  it("копирует эталон и ресурсы, а вырезает только выбранный метод шаблона", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lab-derive-"));
    const code = path.join(root, "code");
    const exercise = path.join(root, "exercise");
    fs.mkdirSync(path.join(code, "tests"), { recursive: true });
    fs.writeFileSync(
      path.join(code, "main.py"),
      "class Loop:\n    def run(self, goal):\n        return goal.upper()\n",
      "utf8",
    );
    fs.writeFileSync(path.join(code, "rules.yml"), "rules: []\n", "utf8");
    fs.writeFileSync(path.join(code, "tests", "test_main.py"), "# авторский suite\n", "utf8");
    fs.writeFileSync(path.join(code, "test_steps_source.py"), "# тест шага\n", "utf8");

    deriveLabExercise(code, exercise, {
      version: 1,
      authorTest: "tests/test_main.py",
      stepTest: "test_steps_source.py",
      targets: [
        {
          file: "main.py",
          symbol: "Loop.run",
          instruction: "Реализуй запуск.",
          tests: ["test_steps.py::test_run", "test_exercise.py"],
        },
      ],
    });

    expect(fs.readFileSync(path.join(exercise, "solution", "main.py"), "utf8")).toContain(
      "return goal.upper()",
    );
    expect(fs.readFileSync(path.join(exercise, "exercise.template", "main.py"), "utf8")).toContain(
      "raise NotImplementedError",
    );
    expect(fs.readFileSync(path.join(exercise, "solution", "rules.yml"), "utf8")).toBe(
      "rules: []\n",
    );
    expect(fs.existsSync(path.join(exercise, "solution", "tests"))).toBe(false);
    expect(fs.readFileSync(path.join(exercise, "test_exercise.py"), "utf8")).toBe(
      "# авторский suite\n",
    );
    expect(fs.existsSync(path.join(exercise, "exercise"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(exercise, "exercise.json"), "utf8"))).toMatchObject({
      version: 1,
      targets: [{ symbol: "Loop.run" }],
      requirements: [],
      network: false,
    });
  });

  it("вендорит зависимость соседней сборки внутрь скрытого runtime-каталога", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lab-resource-"));
    const phase = path.join(root, "19-projects");
    const code = path.join(phase, "20-consumer", "code");
    const dependency = path.join(phase, "19-provider", "outputs");
    const exercise = path.join(root, "exercise");
    fs.mkdirSync(path.join(code, "tests"), { recursive: true });
    fs.mkdirSync(dependency, { recursive: true });
    fs.writeFileSync(path.join(code, "main.py"), "def run():\n    return 1\n", "utf8");
    fs.writeFileSync(path.join(code, "tests", "test_main.py"), "# suite\n", "utf8");
    fs.writeFileSync(path.join(dependency, "taxonomy.json"), "{}\n", "utf8");

    deriveLabExercise(code, exercise, {
      version: 1,
      authorTest: "tests/test_main.py",
      resources: [
        {
          source: "../../19-provider/outputs/taxonomy.json",
          target: "_resources/19-provider/outputs/taxonomy.json",
        },
      ],
      requirements: ["torch", "numpy", "torch"],
      network: true,
      targets: [
        {
          file: "main.py",
          symbol: "run",
          instruction: "Верни результат.",
          tests: ["test_exercise.py"],
        },
      ],
    });

    for (const half of ["solution", "exercise.template"]) {
      expect(
        fs.readFileSync(
          path.join(exercise, half, "_resources", "19-provider", "outputs", "taxonomy.json"),
          "utf8",
        ),
      ).toBe("{}\n");
    }
    expect(JSON.parse(fs.readFileSync(path.join(exercise, "exercise.json"), "utf8"))).toMatchObject({
      requirements: ["numpy", "torch"],
      network: true,
    });
  });
});
