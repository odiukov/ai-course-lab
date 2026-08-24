import { loadConfig } from "@/lib/config";
import { readLessonClarifications } from "@/lib/content/clarifications";
import { readGeneratedVisualIds } from "@/lib/content/generated-visuals";
import { isStale, readLessonPlan } from "@/lib/content/lesson-plan";
import { readStepsById } from "@/lib/content/step-file";
import { finalQuizQuestions, toPublicQuestions, toPublicStep } from "@/lib/practice/questions";
import { openProgressDb } from "@/lib/progress/db";
import { readLessonProgress, readStepIdsInPlan } from "@/lib/progress/steps";
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

  // Спрашивается план, а не то, что лежит в steps: файл схемы принадлежит
  // шагу, который её попросил, а не id, который однажды им был.
  const drawn = new Set(readGeneratedVisualIds(config.contentDir, slug, plan?.steps ?? []));

  return Response.json({
    plan,
    stale: plan ? isStale(plan, source) : false,
    steps: Object.fromEntries(
      Object.entries(steps).map(([id, step]) => [
        id,
        {
          // Верные ответы check-шагов остаются на сервере — ровно по той же
          // причине, что и ответы итогового квиза ниже: проверяет сервер, и
          // ключ ответа в теле ответа API делал бы проверку декорацией.
          ...toPublicStep(step),
          // visual_brief — задание рисовальщику, ридеру оно не нужно; вместо
          // него едет факт «файл на диске есть». Затирается в undefined, а не
          // выбрасывается деструктуризацией: JSON.stringify undefined-поля
          // опускает, и лишней неиспользуемой переменной не появляется.
          visual_brief: undefined,
          generatedVisual: drawn.has(id),
        },
      ]),
    ),
    // Правильные ответы итогового квиза наружу не уходят: проверяет сервер.
    quiz: toPublicQuestions(finalQuizQuestions(source)),
    clarifications: Object.fromEntries(readLessonClarifications(config.contentDir, slug)),
    progress: {
      readStepIds: readStepIdsInPlan(progress.readStepIds, plan?.steps ?? []),
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
