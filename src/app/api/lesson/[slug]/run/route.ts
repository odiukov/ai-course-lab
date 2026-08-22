import path from "node:path";
import { loadConfig } from "@/lib/config";
import { readStep } from "@/lib/content/step-file";
import { readExerciseFiles } from "@/lib/exercise/file";
import { findTreeFile, readExerciseTree } from "@/lib/exercise/tree";
import { PracticeError } from "@/lib/practice/errors";
import { probePythonModule } from "@/lib/practice/health";
import { runScript } from "@/lib/practice/run-script";
import { openProgressDb } from "@/lib/progress/db";
import { markStepFailed, markStepPassed } from "@/lib/progress/steps";
import { recordTestRun } from "@/lib/progress/tests";
import { findLesson } from "@/lib/source/catalog";

interface Body {
  stepId?: unknown;
}

function failureExcerpt(stdout: string, stderr: string): string | null {
  const text = (stderr || stdout).trim();
  return text ? text.split("\n").slice(-3).join("\n") : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as Body;
  const stepId = typeof body.stepId === "string" ? body.stepId.trim() : "";
  if (!stepId) return Response.json({ error: "Не передан stepId" }, { status: 400 });

  const config = loadConfig();
  const ref = findLesson(config.sourceDir, slug);
  if (!ref) return Response.json({ error: "Урок не найден" }, { status: 404 });

  const step = readStep(config.contentDir, slug, stepId);
  if (!step) return Response.json({ error: "Шаг не найден" }, { status: 404 });
  if (step.type !== "run") {
    return Response.json({ error: `У шага типа ${step.type} нет запуска скрипта` }, { status: 400 });
  }
  if (!step.run_file) {
    return Response.json({ error: "У run-шага не указан файл" }, { status: 400 });
  }

  const tree = readExerciseTree(config.sourceDir, ref);
  if (!tree?.run) {
    return Response.json({ error: "У этой лаборатории нет script-зачёта" }, { status: 404 });
  }
  if (step.run_file !== tree.run.file) {
    return Response.json(
      { error: `Лаборатория разрешает запускать ${tree.run.file}, а не ${step.run_file}` },
      { status: 400 },
    );
  }

  const packages = await Promise.all(
    tree.requirements.map(async (name) => ({ name, status: await probePythonModule(config.python, name) })),
  );
  const missing = packages.find((item) => !item.status.ok);
  if (missing) {
    return Response.json(
      { error: missing.status.detail, kind: "python" },
      { status: 503 },
    );
  }

  // Первый запуск может случиться до первого открытия редактора. Чтение
  // создаёт exercise/ из шаблона и докладывает скрытые runtime-ресурсы; без
  // него python получил бы путь к ещё не существующему файлу.
  readExerciseFiles(config.sourceDir, ref);
  const file = findTreeFile(tree, tree.run.file);
  if (!file) return Response.json({ error: `В упражнении нет файла ${tree.run.file}` }, { status: 404 });

  let result;
  try {
    result = await runScript({
      dir: path.dirname(file.workPath),
      file: file.workPath,
      args: tree.run.args,
      python: config.python,
      timeoutMs: tree.run.timeoutMs,
    });
  } catch (error) {
    const kind = error instanceof PracticeError ? error.kind : "output";
    return Response.json({ error: (error as Error).message, kind }, { status: 503 });
  }

  const db = openProgressDb(config.dataDir);
  recordTestRun(db, slug, stepId, tree.run.file, {
    passed: result.passed ? 1 : 0,
    failed: result.passed ? 0 : 1,
    firstFailure: result.passed ? null : failureExcerpt(result.stdout, result.stderr),
    filtered: false,
    warning: null,
  });
  if (result.passed) markStepPassed(db, slug, stepId);
  else markStepFailed(db, slug, stepId);

  return Response.json({ result, state: result.passed ? "passed" : "failed" });
}
