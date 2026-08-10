import { z } from "zod";
import type { AgentEvent } from "../agent/events";
import { renderPrompt } from "../agent/prompts";
import { validatePlan, writeLessonPlan, type LessonPlan } from "../content/lesson-plan";
import { repoRelative } from "../content/paths";
import { stepMetaSchema } from "../content/step-file";
import type { LessonSource } from "../source/lesson-source";
import type { WrittenFunction } from "../source/written-functions";

export interface GenerateDeps {
  run: (prompt: string, onEvent: (event: AgentEvent) => void) => Promise<string>;
}

// Scans `text` starting at the first `[` or `{`, tracking bracket depth so
// that brackets inside JSON string literals (and backslash-escaped
// characters within those strings) don't confuse the scan. Returns the
// slice from that opening bracket to its matching close, or null if no
// balanced JSON value is found.
function sliceBalancedJson(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "[" || ch === "{") {
      depth += 1;
    } else if (ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function extractJsonBlock(text: string): unknown {
  const candidates: string[] = [];
  const fenceRegex = /```(?:\w+)?\s*([\s\S]*?)```/g;
  let fence: RegExpExecArray | null;
  while ((fence = fenceRegex.exec(text)) !== null) {
    candidates.push(fence[1]);
  }
  candidates.push(text);

  for (const candidate of candidates) {
    const slice = sliceBalancedJson(candidate);
    if (slice === null) continue;
    try {
      return JSON.parse(slice);
    } catch {
      continue;
    }
  }

  throw new Error("В ответе агента не найден корректный JSON");
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

  const retryPrompt = (errors: string[]) =>
    `${base}\n\nПредыдущая попытка нарушила правила:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nИсправь и верни план заново.`;

  let prompt = base;
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await deps.run(prompt, onEvent);

    let extracted: unknown;
    try {
      extracted = extractJsonBlock(raw);
    } catch (error) {
      lastErrors = [(error as Error).message];
      prompt = retryPrompt(lastErrors);
      continue;
    }

    const parsed = z.array(stepMetaSchema).safeParse(extracted);
    if (!parsed.success) {
      lastErrors = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    } else {
      lastErrors = validatePlan(parsed.data, source, written);
      if (lastErrors.length === 0) {
        const plan: LessonPlan = {
          slug: source.ref.slug,
          title: source.ref.title,
          lang: source.lang,
          sourcePath: repoRelative(source.textPath),
          sourceHash: source.sourceHash,
          generatedAt: new Date().toISOString(),
          steps: parsed.data,
        };
        writeLessonPlan(contentDir, plan);
        return plan;
      }
    }
    prompt = retryPrompt(lastErrors);
  }

  throw new Error(`Не удалось получить валидный план урока: ${lastErrors.join("; ")}`);
}
