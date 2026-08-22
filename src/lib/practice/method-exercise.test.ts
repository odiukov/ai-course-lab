import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractFunction, replaceFunction } from "@/lib/exercise/file";
import { readExerciseTree } from "@/lib/exercise/tree";
import type { LessonRef } from "@/lib/source/catalog";
import { runTests } from "./run-tests";

const ref: LessonRef = {
  slug: "19-capstone-projects__20-agent-harness-loop-contract",
  phaseDir: "19-capstone-projects",
  lessonDir: "20-agent-harness-loop-contract",
  phaseNumber: 19,
  lessonNumber: 20,
  title: "Agent Harness Loop Contract",
};

describe("первая лаборатория с методами", () => {
  it("каждая заглушка красная, а последовательная реализация делает её точные тесты зелёными", async () => {
    const sourceDir = path.join(process.cwd(), "source");
    const tree = readExerciseTree(sourceDir, ref)!;
    expect(tree.targets).toHaveLength(5);

    const main = tree.files.find((file) => file.name === "main.py")!;
    const solution = fs.readFileSync(main.solutionPath!, "utf8");
    let working = fs.readFileSync(main.templatePath, "utf8");

    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lab-method-acceptance-"));
    const workDir = path.join(temp, "exercise");
    fs.mkdirSync(workDir, { recursive: true });
    for (const file of tree.files) {
      fs.copyFileSync(file.templatePath, path.join(workDir, file.name));
    }
    for (const testPath of tree.testPaths) {
      fs.copyFileSync(testPath, path.join(temp, path.basename(testPath)));
    }

    for (const target of tree.targets!) {
      fs.writeFileSync(path.join(workDir, "main.py"), working, "utf8");
      const red = await runTests({
        dir: temp,
        python: "python3",
        pythonPath: workDir,
        testNodes: target.tests,
      });
      expect(red.failed + red.errors, `${target.fn} должна быть красной заглушкой`).toBeGreaterThan(0);

      const implementation = extractFunction(solution, target.fn);
      expect(implementation, `в эталоне нет ${target.fn}`).not.toBeNull();
      working = replaceFunction(working, target.fn, implementation!);
      fs.writeFileSync(path.join(workDir, "main.py"), working, "utf8");
      const green = await runTests({
        dir: temp,
        python: "python3",
        pythonPath: workDir,
        testNodes: target.tests,
      });
      expect(green, `${target.fn} не прошла назначенные тесты`).toMatchObject({
        failed: 0,
        errors: 0,
      });
      expect(green.passed).toBeGreaterThan(0);
    }

    expect(working).toBe(solution);
  }, 30_000);
});
