import { defaultDeps } from "@/lib/agent/factory";
import { sseStream } from "@/lib/api/sse";
import { loadConfig } from "@/lib/config";
import { isStale, readLessonPlan } from "@/lib/content/lesson-plan";
import { readPhaseOutlines } from "@/lib/content/phase-outlines";
import { generateLessonPlan } from "@/lib/generate/plan-lesson";
import { generateExercise } from "@/lib/generate/write-exercise";
import { ensureSteps } from "@/lib/generate/write-step";
import { runTests } from "@/lib/practice/run-tests";
import { openProgressDb } from "@/lib/progress/db";
import { readAgent } from "@/lib/progress/settings";
import { findLesson } from "@/lib/source/catalog";
import { readLessonSource } from "@/lib/source/lesson-source";
import { readWrittenFunctions } from "@/lib/source/written-functions";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const search = new URL(request.url).searchParams;
  const rawFrom = search.get("from") ?? "0";
  const all = search.get("all") === "1";
  const from = Number(rawFrom);
  if (!Number.isInteger(from) || from < 0) {
    return Response.json(
      { error: `Параметр from должен быть целым числом ≥ 0, получено: ${rawFrom}` },
      { status: 400 },
    );
  }

  const config = loadConfig();
  // Сигнала запроса здесь намеренно нет, в отличие от чата и разбора кода.
  // Разбор урока — это десятки шагов, которые пишутся на диск по одному, и
  // привязка агента к открытой вкладке означала, что уход с каталога убивает
  // его на полуслове. От зависшего CLI страхует не сигнал, а таймаут в
  // runner.ts, а брошенный поток SSE безопасен: sseStream после разрыва
  // просто перестаёт писать.
  const deps = defaultDeps(config, {
    agent: readAgent(openProgressDb(config.dataDir), config.agent),
  });

  return sseStream(async (send) => {
    const ref = findLesson(config.sourceDir, slug);
    if (!ref) throw new Error("Урок не найден");
    let source = readLessonSource(config.sourceDir, ref);

    // Упражнения есть не у каждого урока курса. Без него планировщик получает
    // «(нет упражнения)» и строит урок вообще без code-шагов, то есть без
    // практики — поэтому упражнение придумывается ДО плана, чтобы функции
    // попали планировщику наравне с готовыми.
    if (!source.exercise) {
      send("progress", { stage: "exercise", text: "Придумываю упражнение к уроку" });
      const made = await generateExercise({
        sourceDir: config.sourceDir,
        source,
        deps,
        written: readWrittenFunctions(config.sourceDir),
        check: async (dir) => {
          const outcome = await runTests({ dir, python: config.python });
          if (outcome.passed > 0 && outcome.failed === 0 && outcome.errors === 0) return null;
          const first = outcome.failures[0];
          return first
            ? `${first.name}: ${first.message}`
            : `прошло ${outcome.passed}, упало ${outcome.failed}, ошибок ${outcome.errors}`;
        },
      });

      if ("error" in made) {
        // Не throw: урок без упражнения читается, а без текста — нет. Ошибка
        // показывается тем же кадром, что и провал схемы, и разбор идёт дальше.
        send("error", { message: `Упражнение к уроку не написалось: ${made.error}` });
      } else {
        source = readLessonSource(config.sourceDir, ref);
      }
    }

    let plan = readLessonPlan(config.contentDir, slug);
    if (!plan || isStale(plan, source)) {
      send("progress", { stage: "plan", text: "Составляю план урока" });
      const written = readWrittenFunctions(config.sourceDir);
      plan = await generateLessonPlan({
        contentDir: config.contentDir,
        source,
        deps,
        written,
        outlines: readPhaseOutlines(config.contentDir, slug),
      });
      send("plan", plan);
    }

    send("progress", { stage: "steps", text: "Пишу шаги" });
    const ids = await ensureSteps({
      contentDir: config.contentDir,
      source,
      plan,
      fromIndex: from,
      // `all=1` шлёт каталог: там разбор запускают один раз и уходят, поэтому
      // окно из трёх шагов оставило бы урок недописанным до первого открытия.
      // Ридер параметр не передаёт — ему хватает окна впереди читателя.
      count: all ? plan.steps.length : undefined,
      deps,
      // Прогресс — это «что пишется сейчас», а не поток текста от агента:
      // его хвост обрывается посреди формулы и на экране читается как мусор.
      onStep: ({ number, total, title }) =>
        send("progress", { stage: "steps", text: `Пишу шаг ${number} из ${total}: ${title}` }),
      // Не throw: провал схемы не должен рвать поток и отменять уже
      // написанные шаги. sseStream шлёт "error" только из catch, поэтому
      // кадр отправляется здесь руками — ридер уже умеет его показывать и
      // продолжать чтение.
      onVisualError: (stepId, problem) =>
        send("error", { message: `Схему для шага ${stepId} нарисовать не удалось: ${problem}` }),
    });

    send("done", { ids });
  });
}
