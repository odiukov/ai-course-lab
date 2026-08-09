import { loadConfig } from "@/lib/config";
import { isStale, readLessonPlan } from "@/lib/content/lesson-plan";
import { readStepsById } from "@/lib/content/step-file";
import { findLesson } from "@/lib/source/catalog";
import { readLessonSource } from "@/lib/source/lesson-source";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = loadConfig();
  const ref = findLesson(config.sourceDir, slug);
  if (!ref) return Response.json({ error: "Урок не найден" }, { status: 404 });

  const source = readLessonSource(config.sourceDir, ref);
  const plan = readLessonPlan(config.contentDir, slug);
  // Keyed by plan id, not positional: an unwritten step in the middle of the
  // plan must leave a hole the reader can see, not shift its neighbours.
  const steps = readStepsById(
    config.contentDir,
    slug,
    (plan?.steps ?? []).map((meta) => meta.id),
  );

  return Response.json({
    plan,
    stale: plan ? isStale(plan, source) : false,
    steps,
    source: {
      lang: source.lang,
      visuals: source.visuals,
      functions: source.exercise?.functions ?? [],
      title: ref.title,
    },
  });
}
