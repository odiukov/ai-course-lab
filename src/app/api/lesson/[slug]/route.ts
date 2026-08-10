import { loadConfig } from "@/lib/config";
import { readLessonClarifications } from "@/lib/content/clarifications";
import { isStale, readLessonPlan } from "@/lib/content/lesson-plan";
import { readStepsById } from "@/lib/content/step-file";
import { finalQuizQuestions, toPublicQuestions } from "@/lib/practice/questions";
import { openProgressDb } from "@/lib/progress/db";
import { readLessonProgress } from "@/lib/progress/steps";
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

  // Уточнения и прогресс едут этим же ответом: ридер дёргает эндпоинт после
  // каждой генерации и после каждой записи уточнения, и два отдельных запроса
  // ходили бы за данными, которые уже лежат рядом.
  const progress = readLessonProgress(openProgressDb(config.dataDir), slug);

  return Response.json({
    plan,
    stale: plan ? isStale(plan, source) : false,
    steps,
    // Правильные ответы итогового квиза наружу не уходят: проверяет сервер.
    quiz: toPublicQuestions(finalQuizQuestions(source)),
    clarifications: Object.fromEntries(readLessonClarifications(config.contentDir, slug)),
    progress: {
      readStepIds: progress.readStepIds,
      resumeStepId: progress.resumeStepId,
    },
    source: {
      lang: source.lang,
      visuals: source.visuals,
      functions: source.exercise?.functions ?? [],
      title: ref.title,
    },
  });
}
