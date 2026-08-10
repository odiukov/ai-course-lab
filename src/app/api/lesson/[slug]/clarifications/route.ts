import { loadConfig } from "@/lib/config";
import {
  appendClarification,
  readClarifications,
  readLessonClarifications,
} from "@/lib/content/clarifications";
import { readStep } from "@/lib/content/step-file";
import { markMessageKept } from "@/lib/progress/chat";
import { openProgressDb } from "@/lib/progress/db";

interface KeepBody {
  stepId?: unknown;
  question?: unknown;
  answer?: unknown;
  messageId?: unknown;
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = loadConfig();
  return Response.json(Object.fromEntries(readLessonClarifications(config.contentDir, slug)));
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as KeepBody;
  const stepId = typeof body.stepId === "string" ? body.stepId.trim() : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  const messageId = typeof body.messageId === "number" ? body.messageId : null;

  if (!stepId) {
    return Response.json({ error: "Не передан stepId — некуда дописывать" }, { status: 400 });
  }
  if (!question) {
    return Response.json(
      { error: "Пустой вопрос — без него блок нечем озаглавить" },
      { status: 400 },
    );
  }
  if (!answer) {
    return Response.json({ error: "Пустой ответ — нечего оставлять в теории" }, { status: 400 });
  }

  const config = loadConfig();
  if (!readStep(config.contentDir, slug, stepId)) {
    return Response.json({ error: "Шаг не найден" }, { status: 404 });
  }

  appendClarification(config.contentDir, slug, stepId, {
    askedAt: new Date().toISOString(),
    question,
    answer,
  });

  if (messageId !== null) {
    markMessageKept(openProgressDb(config.dataDir), messageId);
  }

  return Response.json({
    stepId,
    count: readClarifications(config.contentDir, slug, stepId).length,
  });
}
