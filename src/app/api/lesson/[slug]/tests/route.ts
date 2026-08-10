import { loadConfig } from "@/lib/config";
import { readStep } from "@/lib/content/step-file";
import { readExerciseFile } from "@/lib/exercise/file";
import { PracticeError } from "@/lib/practice/errors";
import { runTests } from "@/lib/practice/run-tests";
import { openProgressDb } from "@/lib/progress/db";
import { markStepFailed, markStepPassed } from "@/lib/progress/steps";
import { recordTestRun } from "@/lib/progress/tests";
import { findLesson } from "@/lib/source/catalog";

interface Body {
  stepId?: unknown;
}

// Зелёный прогон требует хотя бы одного реального прохода, а не просто
// отсутствия падений: если все собранные тесты пропущены (skip), pytest
// отдаёт failed=0 и errors=0, но passed тоже 0 — никто ничего не проверил, и
// шаг помечать passed нельзя. Частично пропущенный прогон с хотя бы одним
// настоящим passed и без падений всё ещё зелёный — skip не считается провалом.
export function isPassingRun(result: { passed: number; failed: number; errors: number }): boolean {
  return result.failed === 0 && result.errors === 0 && result.passed > 0;
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as Body;
  const stepId = typeof body.stepId === "string" ? body.stepId.trim() : "";
  if (!stepId) {
    return Response.json({ error: "Не передан stepId" }, { status: 400 });
  }

  const config = loadConfig();
  const ref = findLesson(config.sourceDir, slug);
  if (!ref) return Response.json({ error: "Урок не найден" }, { status: 404 });

  const step = readStep(config.contentDir, slug, stepId);
  if (!step) return Response.json({ error: "Шаг не найден" }, { status: 404 });
  if (step.type !== "code" && step.type !== "recall") {
    return Response.json({ error: `У шага типа ${step.type} нет тестов` }, { status: 400 });
  }
  if (!step.exercise_fn) {
    return Response.json({ error: "У шага не указана функция упражнения" }, { status: 400 });
  }

  const exercise = readExerciseFile(config.sourceDir, ref);
  if (!exercise) {
    return Response.json({ error: "У этого урока нет упражнения" }, { status: 404 });
  }

  try {
    const result = await runTests({
      dir: exercise.dir,
      fn: step.exercise_fn,
      python: config.python,
    });

    const green = isPassingRun(result);
    const db = openProgressDb(config.dataDir);
    recordTestRun(db, slug, stepId, step.exercise_fn, {
      passed: result.passed,
      failed: result.failed + result.errors,
      firstFailure: result.failures[0]?.decisive ?? null,
    });
    if (green) markStepPassed(db, slug, stepId);
    else markStepFailed(db, slug, stepId);

    return Response.json({ result, state: green ? "passed" : "failed" });
  } catch (error) {
    const kind = error instanceof PracticeError ? error.kind : "output";
    // 503, а не 500: сломано окружение, а не запрос. Клиент по этому коду
    // рисует баннер «редактор работает, тесты нет», а не «ошибка сервера».
    return Response.json({ error: (error as Error).message, kind }, { status: 503 });
  }
}
