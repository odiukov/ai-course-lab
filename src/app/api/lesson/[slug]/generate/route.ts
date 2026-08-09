import { defaultDeps } from "@/lib/agent/factory";
import { sseStream } from "@/lib/api/sse";
import { loadConfig } from "@/lib/config";
import { isStale, readLessonPlan } from "@/lib/content/lesson-plan";
import { generateLessonPlan } from "@/lib/generate/plan-lesson";
import { ensureSteps } from "@/lib/generate/write-step";
import { findLesson } from "@/lib/source/catalog";
import { readLessonSource } from "@/lib/source/lesson-source";
import { readWrittenFunctions } from "@/lib/source/written-functions";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rawFrom = new URL(request.url).searchParams.get("from") ?? "0";
  const from = Number(rawFrom);
  if (!Number.isInteger(from) || from < 0) {
    return Response.json(
      { error: `Параметр from должен быть целым числом ≥ 0, получено: ${rawFrom}` },
      { status: 400 },
    );
  }

  const config = loadConfig();
  const deps = defaultDeps(config);

  return sseStream(async (send) => {
    const ref = findLesson(config.sourceDir, slug);
    if (!ref) throw new Error("Урок не найден");
    const source = readLessonSource(config.sourceDir, ref);

    let plan = readLessonPlan(config.contentDir, slug);
    if (!plan || isStale(plan, source)) {
      send("progress", { stage: "plan", text: "Составляю план урока" });
      const written = readWrittenFunctions(config.sourceDir);
      plan = await generateLessonPlan({
        contentDir: config.contentDir,
        source,
        deps,
        written,
        onEvent: (event) => {
          if (event.type === "text") send("progress", { stage: "plan", text: event.text });
        },
      });
      send("plan", plan);
    }

    send("progress", { stage: "steps", text: "Пишу шаги" });
    const ids = await ensureSteps({
      contentDir: config.contentDir,
      source,
      plan,
      fromIndex: from,
      deps,
      onEvent: (event) => {
        if (event.type === "text") send("progress", { stage: "steps", text: event.text });
      },
    });

    send("done", { ids });
  });
}
