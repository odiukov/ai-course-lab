import { loadConfig } from "@/lib/config";
import {
  appendProjectClarification,
  readProject,
  readProjectClarifications,
} from "@/lib/content/project";
import { markMessageKept } from "@/lib/progress/chat";
import { openProgressDb } from "@/lib/progress/db";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = loadConfig();
  const project = readProject(config.contentDir, slug);
  if (!project) return Response.json({ error: "Проект не найден" }, { status: 404 });
  return Response.json(Object.fromEntries(
    project.milestones.map((item) => [item.id, readProjectClarifications(config.contentDir, slug, item.id)]),
  ));
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    stepId?: unknown;
    question?: unknown;
    answer?: unknown;
    messageId?: unknown;
  };
  const milestoneId = typeof body.stepId === "string" ? body.stepId.trim() : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!milestoneId) return Response.json({ error: "Не передан milestone id" }, { status: 400 });
  if (!question) return Response.json({ error: "Пустой вопрос" }, { status: 400 });
  if (!answer) return Response.json({ error: "Пустой ответ" }, { status: 400 });

  const config = loadConfig();
  if (!readProject(config.contentDir, slug)?.milestones.some((item) => item.id === milestoneId)) {
    return Response.json({ error: "Этап не найден" }, { status: 404 });
  }
  appendProjectClarification(config.contentDir, slug, milestoneId, {
    askedAt: new Date().toISOString(),
    question,
    answer,
  });
  if (typeof body.messageId === "number") {
    markMessageKept(openProgressDb(config.dataDir), body.messageId);
  }
  return Response.json({
    milestoneId,
    count: readProjectClarifications(config.contentDir, slug, milestoneId).length,
  });
}
