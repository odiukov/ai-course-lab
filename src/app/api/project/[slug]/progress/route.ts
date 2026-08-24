import { loadConfig } from "@/lib/config";
import { readProject } from "@/lib/content/project";
import { openProgressDb } from "@/lib/progress/db";
import {
  openMilestone,
  readProjectProgress,
  saveMilestoneEvidence,
  saveRubricScore,
} from "@/lib/progress/projects";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = loadConfig();
  if (!readProject(config.contentDir, slug)) return Response.json({ error: "Проект не найден" }, { status: 404 });
  return Response.json(readProjectProgress(openProgressDb(config.dataDir), slug));
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const config = loadConfig();
  const project = readProject(config.contentDir, slug);
  if (!project) return Response.json({ error: "Проект не найден" }, { status: 404 });
  const db = openProgressDb(config.dataDir);

  if (body.action === "open") {
    const milestoneId = typeof body.milestoneId === "string" ? body.milestoneId : "";
    if (!project.milestones.some((item) => item.id === milestoneId)) {
      return Response.json({ error: "Этап не найден" }, { status: 404 });
    }
    openMilestone(db, slug, milestoneId);
  } else if (body.action === "evidence") {
    const milestoneId = typeof body.milestoneId === "string" ? body.milestoneId : "";
    if (!project.milestones.some((item) => item.id === milestoneId)) {
      return Response.json({ error: "Этап не найден" }, { status: 404 });
    }
    const evidence = typeof body.evidence === "string" ? body.evidence.trim() : "";
    const verified = body.verified === true;
    if (verified && !evidence) {
      return Response.json({ error: "Для подтверждения нужно приложить доказательство" }, { status: 400 });
    }
    saveMilestoneEvidence(db, slug, milestoneId, evidence, verified);
  } else if (body.action === "rubric") {
    const criterion = typeof body.criterion === "string" ? body.criterion : "";
    const row = project.rubric.find((item) => item.id === criterion);
    if (!row) return Response.json({ error: "Критерий не найден" }, { status: 404 });
    const score = body.score === null ? null : Number(body.score);
    if (score !== null && (!Number.isInteger(score) || score < 0 || score > row.weight)) {
      return Response.json({ error: `Оценка должна быть от 0 до ${row.weight}` }, { status: 400 });
    }
    saveRubricScore(db, slug, criterion, score, typeof body.note === "string" ? body.note.trim() : "");
  } else {
    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  }

  return Response.json(readProjectProgress(db, slug));
}
