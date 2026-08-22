import matter from "gray-matter";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { lessonPaths } from "./paths";

export const STEP_TYPES = ["theory", "visual", "check", "code", "recall", "quiz"] as const;
export type StepType = (typeof STEP_TYPES)[number];

// Экспортируется, потому что этой же схемой проверяется ответ агента при
// генерации check-шага: форма вопроса должна быть описана один раз.
export const checkSchema = z
  .object({
    question: z.string(),
    // Вопрос с одним вариантом проверять нечем: выбирать не из чего.
    options: z.array(z.string()).min(2, "У вопроса должно быть минимум два варианта"),
    correct: z.number(),
    explanation: z.string().default(""),
  })
  // Индекс правильного ответа обязан указывать НА вариант. Без этой проверки
  // сгенерированный вопрос с correct вне списка спокойно попадал в файл шага, а
  // пройти такой шаг было нельзя никогда: сервер сравнивал ответ с вариантом,
  // которого нет, и любой ответ считался неверным.
  .refine(
    (item) =>
      Number.isInteger(item.correct) && item.correct >= 0 && item.correct < item.options.length,
    { message: "Индекс правильного ответа вне списка вариантов", path: ["correct"] },
  );

export type CheckQuestion = z.infer<typeof checkSchema>;

export const stepMetaSchema = z.object({
  id: z.string().min(1),
  type: z.enum(STEP_TYPES),
  title: z.string().min(1),
  source_anchor: z.string().optional(),
  visual: z.string().optional(),
  // Заявка на схему, которой в курсе нет: одна фраза о том, что показать.
  // min(1) не для красоты — пустой бриф хуже отсутствующего, потому что
  // запускает рисовальщика без задания.
  visual_brief: z.string().min(1).optional(),
  exercise_fn: z.string().optional(),
  /**
   * Файл упражнения, в котором живёт `exercise_fn`. Необязателен: у
   * одно-файлового упражнения он один и подразумевается, а у 382
   * существующих планов этого поля нет и появляться не должно.
   */
  exercise_file: z.string().optional(),
  check: z.array(checkSchema).optional(),
  baseline: z
    .object({
      lesson: z.string(),
      fn: z.string(),
      changes: z.string().min(1),
    })
    .optional(),
});

export type StepMeta = z.infer<typeof stepMetaSchema>;
export interface Step extends StepMeta {
  body: string;
}

export function parseStep(markdown: string): Step {
  const { data, content } = matter(markdown);
  const meta = stepMetaSchema.parse(data);
  return { ...meta, body: content.replace(/^\n+/, "").replace(/\s+$/, "") };
}

export function serializeStep(step: Step): string {
  const { body, ...meta } = step;
  const clean = Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined),
  );
  return matter.stringify(body ? `\n${body}\n` : "", clean);
}

export function readStep(contentDir: string, slug: string, id: string): Step | null {
  const file = lessonPaths(contentDir, slug).stepFile(id);
  if (!fs.existsSync(file)) return null;
  return parseStep(fs.readFileSync(file, "utf8"));
}

/**
 * Reads the steps of `ids` that exist on disk and returns them keyed by step
 * id. Deliberately NOT an array: a lesson can have holes (a hand-edited plan
 * regenerated with new ids, a partial generation window), and a compacted
 * array would silently shift every later step onto the wrong plan position.
 * Callers address a step by its plan id instead.
 */
export function readStepsById(
  contentDir: string,
  slug: string,
  ids: string[],
): Record<string, Step> {
  const steps: Record<string, Step> = {};
  for (const id of ids) {
    const step = readStep(contentDir, slug, id);
    if (step) steps[id] = step;
  }
  return steps;
}

export function writeStep(contentDir: string, slug: string, step: Step): void {
  const file = lessonPaths(contentDir, slug).stepFile(step.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeStep(step), "utf8");
}
