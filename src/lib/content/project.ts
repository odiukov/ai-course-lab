import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  parseClarifications,
  serializeClarification,
  type Clarification,
} from "./clarifications";
import { SAFE_SEGMENT } from "./paths";

const milestoneSchema = z.object({
  id: z.string().regex(/^m\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  task: z.string().min(1),
  doneWhen: z.array(z.string().min(1)).min(1),
  contractTargets: z.array(z.string().min(1)).max(2),
  evidence: z.string().min(1),
});

const projectSchema = z.object({
  version: z.literal(1),
  slug: z.string().refine((value) => SAFE_SEGMENT.test(value)),
  title: z.string().min(1),
  summary: z.string().min(1),
  time: z.string().min(1),
  languages: z.array(z.string().min(1)).min(1),
  prerequisites: z.array(z.string().min(1)),
  phases: z.array(z.string().min(1)),
  tracks: z.array(z.string().min(1)),
  brief: z.object({
    problem: z.string().min(1),
    concept: z.string().min(1),
    architecture: z.string().min(1),
    stack: z.array(z.string().min(1)).min(1),
  }),
  milestones: z.array(milestoneSchema).min(1),
  rubric: z.array(z.object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    weight: z.number().int().positive(),
    criterion: z.string().min(1),
    measurement: z.string().min(1),
  })).min(1),
  sourcePath: z.string().min(1),
  generatedAt: z.string().min(1),
});

export type Project = z.infer<typeof projectSchema>;

export function projectDir(contentDir: string, slug: string): string {
  if (!SAFE_SEGMENT.test(slug)) throw new Error(`Небезопасный slug проекта: ${slug}`);
  return path.join(contentDir, "projects", slug);
}

export function readProject(contentDir: string, slug: string): Project | null {
  const file = path.join(projectDir(contentDir, slug), "project.json");
  if (!fs.existsSync(file)) return null;
  const project = projectSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (project.rubric.reduce((sum, item) => sum + item.weight, 0) !== 100) {
    throw new Error(`Рубрика проекта ${slug} должна весить 100 баллов`);
  }
  const ids = project.milestones.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error(`В проекте ${slug} повторяются milestone id`);
  return project;
}

export function readMilestoneBody(contentDir: string, slug: string, id: string): string {
  if (!SAFE_SEGMENT.test(id)) throw new Error(`Небезопасный milestone id: ${id}`);
  const file = path.join(projectDir(contentDir, slug), "milestones", `${id}.md`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function projectClarificationFile(contentDir: string, slug: string, id: string): string {
  if (!SAFE_SEGMENT.test(id)) throw new Error(`Небезопасный milestone id: ${id}`);
  return path.join(projectDir(contentDir, slug), "clarifications", `${id}.md`);
}

export function readProjectClarifications(contentDir: string, slug: string, id: string): Clarification[] {
  const file = projectClarificationFile(contentDir, slug, id);
  return fs.existsSync(file) ? parseClarifications(fs.readFileSync(file, "utf8")) : [];
}

export function appendProjectClarification(
  contentDir: string,
  slug: string,
  id: string,
  item: Clarification,
): void {
  const file = projectClarificationFile(contentDir, slug, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const prefix = existing.trim().length > 0 ? `${existing.trimEnd()}\n\n` : "";
  fs.writeFileSync(file, `${prefix}${serializeClarification(item)}`, "utf8");
}
