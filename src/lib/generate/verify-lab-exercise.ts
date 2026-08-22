import path from "node:path";
import type { LabExerciseSpec } from "./derive-lab-exercise";
import { runScript } from "../practice/run-script";
import { runTests } from "../practice/run-tests";

function green(result: { passed: number; failed: number; errors: number }): boolean {
  return result.passed > 0 && result.failed === 0 && result.errors === 0;
}

/**
 * Принимает выведенное упражнение в обе стороны: эталон обязан проходить
 * авторский suite и тесты каждого шага, а каждая заглушка — красить именно
 * назначенные ей node IDs. Без второй половины непокрытый шов выглядел бы
 * выполненным сразу после открытия урока.
 */
export async function verifyDerivedLabExercise(
  exerciseDir: string,
  spec: LabExerciseSpec,
  python = "python3",
): Promise<void> {
  const root = path.resolve(exerciseDir);
  const solutionPath = path.join(root, "solution");
  const templatePath = path.join(root, "exercise.template");
  if (spec.run) {
    const options = {
      args: spec.run.args,
      python,
      timeoutMs: spec.run.timeoutMs,
    };
    const solution = await runScript({
      ...options,
      dir: solutionPath,
      file: path.join(solutionPath, spec.run.file),
    });
    if (!solution.passed) {
      throw new Error(`Эталон лаборатории завершился с кодом ${solution.exitCode}`);
    }
    const template = await runScript({
      ...options,
      dir: templatePath,
      file: path.join(templatePath, spec.run.file),
    });
    if (template.passed) {
      throw new Error("Шаблон лаборатории завершился с кодом 0 — вырезанные швы не проверяются запуском");
    }
    return;
  }

  const author = await runTests({
    dir: root,
    python,
    pythonPath: solutionPath,
    testNodes: ["test_exercise.py"],
  });
  if (!green(author)) {
    throw new Error(
      `Эталон лаборатории не проходит авторский suite: ${author.passed} зелёных, ` +
        `${author.failed + author.errors} красных`,
    );
  }

  for (const target of spec.targets) {
    if (!target.tests || target.tests.length === 0) {
      throw new Error(`У цели ${target.file}::${target.symbol} не назначены тесты`);
    }
    const solution = await runTests({
      dir: root,
      python,
      pythonPath: solutionPath,
      testNodes: target.tests,
    });
    if (!green(solution)) {
      throw new Error(`Эталон ${target.file}::${target.symbol} не проходит назначенные тесты`);
    }
    const template = await runTests({
      dir: root,
      python,
      pythonPath: templatePath,
      testNodes: target.tests,
    });
    if (green(template)) {
      throw new Error(
        `Заглушка ${target.file}::${target.symbol} осталась зелёной — назначенные тесты не проверяют шов`,
      );
    }
  }
}
