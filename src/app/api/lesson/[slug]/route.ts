import { loadConfig } from "@/lib/config";
import { readLessonClarifications } from "@/lib/content/clarifications";
import { readGeneratedVisualIds } from "@/lib/content/generated-visuals";
import { isStale, readLessonPlan } from "@/lib/content/lesson-plan";
import { readStepsById } from "@/lib/content/step-file";
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

  // visual_brief — задание рисовальщику, ридеру оно не нужно; вместо него
  // едет факт «файл на диске есть». Отбрасывается тем же приёмом, что `body`
  // в serializeStep (step-file.ts:48) — лишняя переменная в деструктуризации
  // здесь не ошибка линта, а сложившийся в репо способ выкинуть поле.
  const drawn = new Set(readGeneratedVisualIds(config.contentDir, slug, Object.keys(steps)));

  return Response.json({
    plan,
    stale: plan ? isStale(plan, source) : false,
    steps: Object.fromEntries(
      Object.entries(steps).map(([id, step]) => {
        const { visual_brief, ...rest } = step;
        return [id, { ...rest, generatedVisual: drawn.has(id) }];
      }),
    ),
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
