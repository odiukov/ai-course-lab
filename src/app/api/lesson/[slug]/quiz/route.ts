import { loadConfig } from "@/lib/config";
import { readStep } from "@/lib/content/step-file";
import { allAnsweredCorrectly, gradeAnswer, stepQuestions } from "@/lib/practice/questions";
import { openProgressDb } from "@/lib/progress/db";
import { readLatestAttempts, recordQuizAttempt } from "@/lib/progress/quiz";
import { markStepFailed, markStepPassed } from "@/lib/progress/steps";
import { findLesson } from "@/lib/source/catalog";
import { readLessonSource } from "@/lib/source/lesson-source";

interface Body {
  stepId?: unknown;
  questionIndex?: unknown;
  answerIndex?: unknown;
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const stepId = new URL(request.url).searchParams.get("stepId")?.trim() ?? "";
  if (!stepId) return Response.json({ error: "Не передан stepId" }, { status: 400 });

  const config = loadConfig();
  const latest = readLatestAttempts(openProgressDb(config.dataDir), slug, stepId);
  return Response.json({ attempts: [...latest.values()] });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as Body;
  const stepId = typeof body.stepId === "string" ? body.stepId.trim() : "";
  const questionIndex = body.questionIndex;
  const answerIndex = body.answerIndex;

  if (!stepId) return Response.json({ error: "Не передан stepId" }, { status: 400 });
  if (!Number.isInteger(questionIndex) || (questionIndex as number) < 0) {
    return Response.json({ error: "questionIndex должен быть целым числом ≥ 0" }, { status: 400 });
  }
  if (!Number.isInteger(answerIndex) || (answerIndex as number) < 0) {
    return Response.json({ error: "answerIndex должен быть целым числом ≥ 0" }, { status: 400 });
  }

  const config = loadConfig();
  const ref = findLesson(config.sourceDir, slug);
  const step = readStep(config.contentDir, slug, stepId);
  if (!ref || !step) return Response.json({ error: "Урок или шаг не найден" }, { status: 404 });

  const questions = stepQuestions(step, readLessonSource(config.sourceDir, ref));
  if (questions.length === 0) {
    return Response.json({ error: "У этого шага нет вопросов" }, { status: 400 });
  }

  let graded;
  try {
    graded = gradeAnswer(questions, questionIndex as number, answerIndex as number);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }

  const db = openProgressDb(config.dataDir);
  recordQuizAttempt(db, slug, stepId, questionIndex as number, answerIndex as number, graded.correct);

  const latest = readLatestAttempts(db, slug, stepId);
  const done = allAnsweredCorrectly(questions, latest);
  if (done) markStepPassed(db, slug, stepId);
  else if (!graded.correct) markStepFailed(db, slug, stepId);

  return Response.json({ ...graded, state: done ? "passed" : graded.correct ? "read" : "failed" });
}
