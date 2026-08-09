import type { AgentEvent } from "../agent/events";
import { renderPrompt } from "../agent/prompts";
import type { LessonPlan } from "../content/lesson-plan";
import { readStep, writeStep, type Step } from "../content/step-file";
import type { LessonSource } from "../source/lesson-source";
import type { GenerateDeps } from "./plan-lesson";

const MAX_EXCERPT = 6000;

export function excerptForStep(source: LessonSource, anchor?: string): string {
  if (!anchor) return source.text.slice(0, MAX_EXCERPT);
  const start = source.text.indexOf(anchor);
  if (start === -1) return source.text.slice(0, MAX_EXCERPT);
  const level = (/^#+/.exec(anchor.trim())?.[0] ?? "#").length;
  const rest = source.text.slice(start + anchor.length);
  const next = new RegExp(`^#{1,${level}} `, "m").exec(rest);
  const end = next ? start + anchor.length + next.index : source.text.length;
  return source.text.slice(start, Math.min(end, start + MAX_EXCERPT));
}

function neighbourSummary(plan: LessonPlan, index: number): string {
  return plan.steps
    .slice(Math.max(0, index - 2), index + 2)
    .filter((_, offset) => Math.max(0, index - 2) + offset !== index)
    .map((step) => `- ${step.type}: ${step.title}`)
    .join("\n") || "(соседей нет)";
}

export async function ensureSteps(opts: {
  contentDir: string;
  source: LessonSource;
  plan: LessonPlan;
  fromIndex: number;
  count?: number;
  deps: GenerateDeps;
  onEvent?: (event: AgentEvent) => void;
}): Promise<string[]> {
  const { contentDir, source, plan, fromIndex, deps } = opts;
  const onEvent = opts.onEvent ?? (() => {});
  const count = opts.count ?? 3;
  const window = plan.steps.slice(fromIndex, fromIndex + count);
  const written: string[] = [];

  for (const [offset, meta] of window.entries()) {
    if (readStep(contentDir, plan.slug, meta.id)) continue;

    const prompt = renderPrompt("write-step", {
      lesson_title: plan.title,
      step_title: meta.title,
      step_type: meta.type,
      neighbours: neighbourSummary(plan, fromIndex + offset),
      source_excerpt: excerptForStep(source, meta.source_anchor),
    });

    const body = (await deps.run(prompt, onEvent)).trim();
    const step: Step = { ...meta, body };
    writeStep(contentDir, plan.slug, step);
    written.push(meta.id);
  }

  return written;
}
