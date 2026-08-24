import { defaultDeps } from "@/lib/agent/factory";
import { sseStream } from "@/lib/api/sse";
import { loadConfig } from "@/lib/config";
import {
  readMilestoneBody,
  readProject,
  readProjectClarifications,
} from "@/lib/content/project";
import { explainStep } from "@/lib/generate/explain";
import {
  addChatMessage,
  findChatSession,
  formatHistory,
  openChatSession,
  recentHistory,
} from "@/lib/progress/chat";
import { openProgressDb } from "@/lib/progress/db";
import { readAgent } from "@/lib/progress/settings";

const MAX_QUESTION = 2000;

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const milestoneId = new URL(request.url).searchParams.get("stepId")?.trim() ?? "";
  if (!milestoneId) return Response.json({ error: "Не передан milestone id" }, { status: 400 });
  const config = loadConfig();
  if (!readProject(config.contentDir, slug)?.milestones.some((item) => item.id === milestoneId)) {
    return Response.json({ error: "Этап не найден" }, { status: 404 });
  }
  return Response.json({ session: findChatSession(openProgressDb(config.dataDir), slug, milestoneId) });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as { stepId?: unknown; question?: unknown };
  const milestoneId = typeof body.stepId === "string" ? body.stepId.trim() : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!milestoneId) return Response.json({ error: "Не передан milestone id" }, { status: 400 });
  if (!question) return Response.json({ error: "Пустой вопрос" }, { status: 400 });
  if (question.length > MAX_QUESTION) {
    return Response.json({ error: `Вопрос длиннее ${MAX_QUESTION} символов` }, { status: 400 });
  }

  const config = loadConfig();
  const project = readProject(config.contentDir, slug);
  const milestone = project?.milestones.find((item) => item.id === milestoneId);
  if (!project || !milestone) return Response.json({ error: "Этап не найден" }, { status: 404 });
  const db = openProgressDb(config.dataDir);
  const deps = defaultDeps(config, { signal: request.signal, agent: readAgent(db, config.agent) });
  const clarifications = readProjectClarifications(config.contentDir, slug, milestoneId);
  const context = clarifications.length === 0
    ? "(вопросов по этому этапу ещё не было)"
    : clarifications.slice(-12).reverse().map((item) => `- ${item.question}`).join("\n");

  return sseStream(async (send) => {
    const sessionId = openChatSession(db, slug, milestoneId);
    const history = formatHistory(recentHistory(db, sessionId, 6));
    addChatMessage(db, sessionId, "user", question);
    const text = await explainStep({
      request: {
        lessonTitle: project.title,
        step: {
          id: milestone.id,
          type: "theory",
          title: milestone.title,
          body: [milestone.task, readMilestoneBody(config.contentDir, slug, milestoneId)].join("\n\n"),
        },
        clarifications: context,
        history,
        question,
      },
      deps,
      onEvent: (event) => {
        if (event.type === "text") send("token", { text: event.text });
      },
    });
    const messageId = addChatMessage(db, sessionId, "assistant", text);
    send("done", { sessionId, messageId, text });
  });
}
