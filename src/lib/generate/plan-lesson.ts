import { z } from "zod";
import type { AgentEvent } from "../agent/events";
import { renderPrompt } from "../agent/prompts";
import { validatePlan, writeLessonPlan, type LessonPlan } from "../content/lesson-plan";
import { repoRelative } from "../content/paths";
import { formatPhaseOutlines, type LessonOutline } from "../content/phase-outlines";
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

/**
 * Нижняя граница — защита от «урока» в один экран, а не требование объёма.
 *
 * Раньше здесь стояло 15, доставшихся от плоского диапазона в промпте. С
 * бюджетом, посчитанным от содержания, такой пол вреден с другой стороны:
 * исходнику на две сотни слов он предписывал пятнадцать экранов, то есть ровно
 * то размазывание одной мысли, против которого весь этот счёт и заведён.
 */
export const MIN_STEPS = 5;

/**
 * Потолок, который защищает от мегаурока, а не от подробности.
 *
 * Раньше здесь стояло 40, и это было мало: в курсе 507 уроков, медиана 1443
 * слова, но у 90-го процентиля 2938, а у самого длинного 5933. При экране на
 * каждую мысль сорок шагов обрезали как раз те уроки, где мыслей больше
 * всего. Шестьдесят — это уже не «слишком подробно», а сигнал, что исходник
 * тянет на главу и его стоило бы разделить.
 */
export const MAX_STEPS = 60;

/** Слов в исходнике урока — грубо, по разделителям. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Слов исходника на один экран теории.
 *
 * Исходник курса — плотная справочная проза: абзац там нередко вводит термин,
 * правило и следствие сразу. Шаг же обещает обратное — один экран, одна
 * мысль. 80 слов на шаг и означают этот перевод: разбирать мелко, а не
 * пересказывать абзац абзацем. Число задаёт ПЛОТНОСТЬ разбора и ни к какому
 * итоговому количеству шагов не подгоняется — сколько мыслей в тексте,
 * столько и экранов.
 */
const WORDS_PER_STEP = 80;

/**
 * Сколько примерно шагов заслуживает этот урок.
 *
 * Диапазон в промпте был плоский — «15-40» независимо от того, урок на 2500
 * слов или на 1200, — и модель тянулась к верхней границе независимо от того,
 * есть ли в тексте столько мыслей.
 *
 * Считается от того, из чего шаги и берутся: экран теории на каждые
 * WORDS_PER_STEP слов исходника, плюс по шагу на каждую функцию упражнения
 * (их пропустить нельзя), плюс итоговый quiz. Это ориентир, а не закон: промпт
 * разрешает отклониться, потому что число мыслей в тексте с числом слов
 * связано, но не жёстко.
 */
export function stepBudget(wordCount: number, functionCount: number): number {
  const theory = Math.round(wordCount / WORDS_PER_STEP);
  return Math.min(MAX_STEPS, Math.max(MIN_STEPS, theory + functionCount + 1));
}

export async function generateLessonPlan(opts: {
  contentDir: string;
  source: LessonSource;
  deps: GenerateDeps;
  written?: WrittenFunction[];
  /**
   * Оглавления уже разобранных уроков той же фазы. Без них планировщик знает
   * только свой урок и заново разбирает то, что сосед уже объяснил.
   */
  outlines?: LessonOutline[];
  onEvent?: (event: AgentEvent) => void;
}): Promise<LessonPlan> {
  const { contentDir, source, deps } = opts;
  const onEvent = opts.onEvent ?? (() => {});

  const written = opts.written ?? [];
  const functionCount = source.exercise?.functions.length ?? 0;
  const budget = stepBudget(countWords(source.text), functionCount);
  const base = renderPrompt("plan-lesson", {
    other_lessons: formatPhaseOutlines(opts.outlines ?? []),
    step_budget: String(budget),
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
      lastErrors = validatePlan(parsed.data, source, written, budget);
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
