import matter from "gray-matter";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { lessonPaths } from "./paths";

export const STEP_TYPES = ["theory", "visual", "check", "code", "recall", "quiz"] as const;
export type StepType = (typeof STEP_TYPES)[number];

const checkSchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
  correct: z.number(),
  explanation: z.string().default(""),
});

export type CheckQuestion = z.infer<typeof checkSchema>;

export const stepMetaSchema = z.object({
  id: z.string().min(1),
  type: z.enum(STEP_TYPES),
  title: z.string().min(1),
  source_anchor: z.string().optional(),
  visual: z.string().optional(),
  exercise_fn: z.string().optional(),
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

export function writeStep(contentDir: string, slug: string, step: Step): void {
  const file = lessonPaths(contentDir, slug).stepFile(step.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeStep(step), "utf8");
}
