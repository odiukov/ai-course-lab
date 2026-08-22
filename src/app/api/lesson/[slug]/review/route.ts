import fs from "node:fs";
import { defaultDeps } from "@/lib/agent/factory";
import { sseStream } from "@/lib/api/sse";
import { loadConfig } from "@/lib/config";
import { readLessonPlan } from "@/lib/content/lesson-plan";
import { readStep } from "@/lib/content/step-file";
import { extractFunction, readExerciseFiles, type ExerciseFileSet, type ExerciseFileState } from "@/lib/exercise/file";
import { findTreeFile, readExerciseTree, resolveExerciseFile, type ExerciseTree } from "@/lib/exercise/tree";
import { formatMetrics, formatRuff, formatTests, reviewCode } from "@/lib/generate/review-code";
import { runBench } from "@/lib/practice/bench";
import { addChatMessage, openChatSession } from "@/lib/progress/chat";
import { openProgressDb } from "@/lib/progress/db";
import { readAgent } from "@/lib/progress/settings";
import { lastTestRun } from "@/lib/progress/tests";
import { findLesson } from "@/lib/source/catalog";

interface Body {
  stepId?: unknown;
}

interface ReviewTargets {
  exercise: ExerciseFileState;
  /** null у одно-файлового упражнения без эталона — "(эталона нет)", не исключение. */
  solutionPath: string | null;
}

/**
 * Файл человека и путь эталона для разбора кода — тем же именем, что видят
 * тесты/замер/reset (resolveExerciseFile), а не литералом "exercise.py": в
 * каталожной форме файл человека называется иначе (main.py, hooks.py), и
 * подстановка имени в set.files должна искать именно его. Путь эталона — не
 * склейка `<dir>/solution.py` (она верна только для одно-файловой формы), а
 * solutionPath из дерева: он у каждого файла свой и сам различает обе формы.
 *
 * Вынесена отдельно от POST ради теста: поднимать весь маршрут (SSE, агент,
 * прогрев бенчмарка) в тесте дорого, а эта функция — чистая и решает именно
 * тот выбор, из-за которого маршрут раньше 404-ился на каталожной форме.
 */
export function resolveReviewTargets(
  tree: ExerciseTree,
  set: ExerciseFileSet,
  fn: string,
  declaredFile: string | undefined,
): ReviewTargets | null {
  const fileName = resolveExerciseFile(tree, fn, declaredFile);
  const exercise = set.files.find((item) => item.name === fileName);
  if (!exercise) return null;
  return { exercise, solutionPath: findTreeFile(tree, fileName)?.solutionPath ?? null };
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as Body;
  const stepId = typeof body.stepId === "string" ? body.stepId.trim() : "";
  if (!stepId) return Response.json({ error: "Не передан stepId" }, { status: 400 });

  const config = loadConfig();
  const ref = findLesson(config.sourceDir, slug);
  const plan = readLessonPlan(config.contentDir, slug);
  const step = readStep(config.contentDir, slug, stepId);
  if (!ref || !plan || !step) {
    return Response.json({ error: "Урок или шаг не найден" }, { status: 404 });
  }
  if (!step.exercise_fn) {
    return Response.json({ error: "У шага нет функции упражнения" }, { status: 400 });
  }

  const db = openProgressDb(config.dataDir);
  const run = lastTestRun(db, slug, stepId);
  if (!run || run.failed > 0 || run.passed === 0) {
    // Тот же порядок, что в скилле /check-code: числа и разбор бессмысленны
    // против красного кода, и мешают увидеть настоящую проблему.
    return Response.json(
      { error: "Сначала зелёные тесты — разбор идёт после них" },
      { status: 409 },
    );
  }

  const fn = step.exercise_fn;

  const tree = readExerciseTree(config.sourceDir, ref);
  const set = readExerciseFiles(config.sourceDir, ref);
  const targets = tree && set ? resolveReviewTargets(tree, set, fn, step.exercise_file) : null;
  if (!tree || !set || !targets) {
    return Response.json({ error: "У урока нет упражнения" }, { status: 404 });
  }
  const { exercise, solutionPath } = targets;

  const solutionCode = solutionPath
    ? (extractFunction(fs.readFileSync(solutionPath, "utf8"), fn) ?? "(в эталоне такой функции нет)")
    : "(эталона нет)";
  const mineCode = extractFunction(exercise.code, fn) ?? exercise.code;

  // Каталожная форма держит файлы человека и эталона не в корне, а в
  // exercise/ и solution/ — bench.py нужно явно назвать модуль, иначе он
  // возьмёт устаревший корневой exercise.py/solution.py. Одно-файловая форма
  // ведёт себя ровно как раньше: module не передаётся вовсе.
  // Не называем переменную module: next/eslint запрещает — это зарезервированное
  // имя CJS-модуля, и присвоение ему маскирует реальный module в области видимости.
  const benchModule = tree.multi ? exercise.name : undefined;

  const deps = defaultDeps(config, { signal: request.signal, agent: readAgent(db, config.agent) });

  return sseStream(async (send) => {
    // Сигнал запроса — в замер: он гоняет код учащегося тысячи раз и без
    // сигнала закрытая вкладка оставляет python молотить до двух минут.
    const report = await runBench({
      dir: set.dir,
      fn,
      module: benchModule,
      python: config.python,
      signal: request.signal,
    });
    send("bench", report);

    const text = await reviewCode({
      request: {
        lessonTitle: plan.title,
        stepTitle: step.title,
        fn,
        mineCode,
        solutionCode,
        // Числа и охват — из записи прогона, а не выдуманные: подстановка
        // total = passed рассказывала агенту о полном покрытии, которого не было.
        tests: formatTests({
          passed: run.passed,
          failed: run.failed,
          filtered: run.filtered,
          warning: run.warning,
        }),
        metrics: formatMetrics(report.functions.find((item) => item.fn === fn)),
        ruff: formatRuff(report.ruff, fn),
      },
      deps,
      onEvent: (event) => {
        if (event.type === "text") send("token", { text: event.text });
      },
    });

    // Разбор живёт в той же сессии чата шага — спека требует, чтобы он остался
    // в истории урока, а не исчез вместе с панелью.
    const sessionId = openChatSession(db, slug, stepId);
    addChatMessage(db, sessionId, "user", `Разбери мой код функции ${fn}`);
    const messageId = addChatMessage(db, sessionId, "assistant", text);
    send("done", { messageId, text });
  });
}
