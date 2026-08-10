import { loadConfig } from "@/lib/config";
import { readLessonPlan } from "@/lib/content/lesson-plan";
import { openProgressDb } from "@/lib/progress/db";
import {
  markStepOpened,
  markStepRead,
  readLessonProgress,
  resumeIndex,
} from "@/lib/progress/steps";

interface ProgressBody {
  stepId?: unknown;
  event?: unknown;
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = loadConfig();
  const db = openProgressDb(config.dataDir);
  const progress = readLessonProgress(db, slug);
  const plan = readLessonPlan(config.contentDir, slug);

  return Response.json({
    ...progress,
    resumeIndex: plan ? resumeIndex(progress, plan.steps) : 0,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as ProgressBody;
  const stepId = typeof body.stepId === "string" ? body.stepId.trim() : "";
  const event = body.event;

  if (!stepId) {
    return Response.json({ error: "Не передан stepId" }, { status: 400 });
  }
  if (event !== "opened" && event !== "read") {
    return Response.json(
      { error: `Поле event должно быть "opened" или "read", получено: ${String(event)}` },
      { status: 400 },
    );
  }

  const config = loadConfig();
  const db = openProgressDb(config.dataDir);
  if (event === "opened") {
    markStepOpened(db, slug, stepId);
  } else {
    markStepRead(db, slug, stepId);
  }

  return Response.json({ ok: true });
}
