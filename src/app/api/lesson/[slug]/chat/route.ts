import { defaultDeps } from "@/lib/agent/factory";
import { sseStream } from "@/lib/api/sse";
import { loadConfig } from "@/lib/config";
import { buildClarificationContext } from "@/lib/content/clarification-context";
import { readLessonPlan } from "@/lib/content/lesson-plan";
import { readStep } from "@/lib/content/step-file";
import { explainStep } from "@/lib/generate/explain";
import {
  addChatMessage,
  findChatSession,
  formatHistory,
  openChatSession,
  recentHistory,
} from "@/lib/progress/chat";
import { openProgressDb } from "@/lib/progress/db";

const MAX_QUESTION = 2000;

interface ChatBody {
  stepId?: unknown;
  question?: unknown;
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const stepId = new URL(request.url).searchParams.get("stepId")?.trim() ?? "";
  if (!stepId) {
    return Response.json({ error: "Не передан stepId" }, { status: 400 });
  }

  const config = loadConfig();
  const db = openProgressDb(config.dataDir);
  return Response.json({ session: findChatSession(db, slug, stepId) });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as ChatBody;
  const stepId = typeof body.stepId === "string" ? body.stepId.trim() : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";

  if (!stepId) {
    return Response.json(
      { error: "Не передан stepId — непонятно, к какому шагу вопрос" },
      { status: 400 },
    );
  }
  if (!question) {
    return Response.json({ error: "Пустой вопрос" }, { status: 400 });
  }
  if (question.length > MAX_QUESTION) {
    return Response.json({ error: `Вопрос длиннее ${MAX_QUESTION} символов` }, { status: 400 });
  }

  const config = loadConfig();
  const plan = readLessonPlan(config.contentDir, slug);
  const step = readStep(config.contentDir, slug, stepId);
  if (!plan || !step) {
    return Response.json(
      { error: "Шаг не найден — сначала он должен быть сгенерирован" },
      { status: 404 },
    );
  }

  const db = openProgressDb(config.dataDir);
  // Same signal as generation: a closed tab kills the child instead of leaving
  // the serial queue wedged for every later request.
  const deps = defaultDeps(config, { signal: request.signal });

  return sseStream(async (send) => {
    const sessionId = openChatSession(db, slug, stepId);
    // История собирается до записи нового вопроса, иначе он попал бы в промпт
    // дважды: и как история, и как сам вопрос.
    const history = formatHistory(recentHistory(db, sessionId, 6));
    addChatMessage(db, sessionId, "user", question);

    const text = await explainStep({
      request: {
        lessonTitle: plan.title,
        step,
        clarifications: buildClarificationContext({
          contentDir: config.contentDir,
          slug,
          steps: plan.steps,
          beforeStepId: stepId,
          includeCurrent: true,
        }),
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
