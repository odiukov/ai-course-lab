import path from "node:path";
import { loadConfig } from "@/lib/config";
import { readStep } from "@/lib/content/step-file";
import { readCanonicalFunctionNames } from "@/lib/exercise/file";
import { readExerciseTree } from "@/lib/exercise/tree";
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

  const tree = readExerciseTree(config.sourceDir, ref);
  if (!tree) {
    return Response.json({ error: "У этого урока нет упражнения" }, { status: 404 });
  }

  const fileName = step.exercise_file ?? "exercise.py";
  // Фильтр -k про файлы ничего не знает: у имени, встречающегося в нескольких
  // файлах упражнения, он собрал бы тесты соседнего модуля вместо своих.
  // Честнее прогнать весь файл тестов и сказать об этом прямо, чем покрасить
  // шаг за чужую заготовку.
  const duplicated = tree.duplicateFunctions.includes(step.exercise_fn);

  // В try — только прогон: он единственный ломается из-за окружения и только
  // он имеет право ответить 503 «проверь PYTHON». Записи в базу вынесены
  // наружу: упавший SQLite — это не «нет питона», и называть учащемуся не ту
  // причину нельзя.
  let outcome;
  try {
    outcome = await runTests({
      dir: tree.dir,
      fn: duplicated ? undefined : step.exercise_fn,
      // Остальные функции упражнения: из них собирается выражение -k, которое
      // не тянет в прогон тесты ещё не написанных функций. Состав берётся из
      // шаблона, а НЕ из файла учащегося: вспомогательная функция, которую он
      // написал себе сам, попала бы в отрицание и молча отрезала настоящий
      // тест шага (`def shape(M)` рядом с identity убивал
      // test_identity_shape_and_content).
      functions: readCanonicalFunctionNames(config.sourceDir, ref),
      python: config.python,
      // Каталожная форма держит файлы человека в exercise/ рядом с
      // тестами — без PYTHONPATH на этот каталог pytest импортировал бы либо
      // ничего, либо чужой solution/.
      pythonPath: tree.multi ? path.join(tree.dir, "exercise") : undefined,
      testFile: tree.testPath ?? undefined,
    });
  } catch (error) {
    const kind = error instanceof PracticeError ? error.kind : "output";
    // 503, а не 500: сломано окружение, а не запрос. Клиент по этому коду
    // рисует баннер «редактор работает, тесты нет», а не «ошибка сервера».
    return Response.json({ error: (error as Error).message, kind }, { status: 503 });
  }

  const warning = duplicated
    ? `Функция ${step.exercise_fn} есть в нескольких файлах упражнения — прогнан весь файл тестов`
    : outcome.warning;
  const result = { ...outcome, warning };

  const green = isPassingRun(result);
  const db = openProgressDb(config.dataDir);
  // Для многофайлового упражнения в exercise_fn пишется пара «файл::функция»:
  // без файла две одноимённые функции разных модулей сливались бы в истории
  // прогонов в одну строку.
  const exerciseFn = tree.multi ? `${fileName}::${step.exercise_fn}` : step.exercise_fn;
  recordTestRun(db, slug, stepId, exerciseFn, {
    passed: result.passed,
    failed: result.failed + result.errors,
    firstFailure: result.failures[0]?.decisive ?? null,
    filtered: result.filtered,
    warning: result.warning,
  });
  if (green) markStepPassed(db, slug, stepId);
  else markStepFailed(db, slug, stepId);

  return Response.json({ result, state: green ? "passed" : "failed" });
}
