import { z } from "zod";
import type { AgentEvent } from "../agent/events";
import { renderPrompt } from "../agent/prompts";
import { validatePlan, writeLessonPlan, type LessonPlan } from "../content/lesson-plan";
import { stepMetaSchema } from "../content/step-file";
import type { LessonSource } from "../source/lesson-source";
import type { WrittenFunction } from "../source/written-functions";

export interface GenerateDeps {
  run: (prompt: string, onEvent: (event: AgentEvent) => void) => Promise<string>;
}

export function extractJsonBlock(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("В ответе агента не найден JSON");
  const sliced = candidate.slice(start).trimEnd();
  try {
    return JSON.parse(sliced);
  } catch (error) {
    throw new Error(`В ответе агента не найден корректный JSON: ${(error as Error).message}`);
  }
}

export async function generateLessonPlan(opts: {
  contentDir: string;
  source: LessonSource;
  deps: GenerateDeps;
  written?: WrittenFunction[];
  onEvent?: (event: AgentEvent) => void;
}): Promise<LessonPlan> {
  const { contentDir, source, deps } = opts;
  const onEvent = opts.onEvent ?? (() => {});

  const written = opts.written ?? [];
  const base = renderPrompt("plan-lesson", {
    lesson_title: source.ref.title,
    source_text: source.text,
    functions: (source.exercise?.functions ?? []).map((fn) => `- ${fn}`).join("\n") || "(нет упражнения)",
    visuals: source.visuals.map((v) => `- ${v}`).join("\n") || "(нет визуализаций)",
    written_functions:
      written
        .map((item) => `- ${item.signature} — урок ${item.lessonSlug ?? item.exerciseSlug}`)
        .join("\n") || "(ничего ещё не написано)",
  });

  let prompt = base;
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await deps.run(prompt, onEvent);
    const parsed = z.array(stepMetaSchema).safeParse(extractJsonBlock(raw));
    if (!parsed.success) {
      lastErrors = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    } else {
      lastErrors = validatePlan(parsed.data, source, written);
      if (lastErrors.length === 0) {
        const plan: LessonPlan = {
          slug: source.ref.slug,
          title: source.ref.title,
          lang: source.lang,
          sourcePath: source.textPath,
          sourceHash: source.sourceHash,
          generatedAt: new Date().toISOString(),
          steps: parsed.data,
        };
        writeLessonPlan(contentDir, plan);
        return plan;
      }
    }
    prompt = `${base}\n\nПредыдущая попытка нарушила правила:\n${lastErrors.map((e) => `- ${e}`).join("\n")}\n\nИсправь и верни план заново.`;
  }

  throw new Error(`Не удалось получить валидный план урока: ${lastErrors.join("; ")}`);
}
