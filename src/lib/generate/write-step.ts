import type { AgentEvent } from "../agent/events";
import { renderPrompt } from "../agent/prompts";
import type { LessonPlan } from "../content/lesson-plan";
import { readStep, writeStep, type Step, type StepMeta } from "../content/step-file";
import type { LessonSource } from "../source/lesson-source";
import type { GenerateDeps } from "./plan-lesson";

const MAX_EXCERPT = 6000;

// Finds `anchor` at or after `offset`, requiring it to start a line (so a
// heading string can't match inside a code block or a sentence), and skips
// past any mid-line false positive to keep searching.
function locateAnchor(text: string, anchor: string, offset: number): number {
  let idx = text.indexOf(anchor, offset);
  while (idx !== -1 && idx !== 0 && text[idx - 1] !== "\n") {
    idx = text.indexOf(anchor, idx + 1);
  }
  return idx;
}

export function excerptForStep(source: LessonSource, anchor?: string, offset = 0): string {
  if (!anchor) return source.text.slice(0, MAX_EXCERPT);
  const start = locateAnchor(source.text, anchor, offset);
  if (start === -1) return source.text.slice(0, MAX_EXCERPT);
  const level = (/^#+/.exec(anchor.trim())?.[0] ?? "#").length;
  const rest = source.text.slice(start + anchor.length);
  const next = new RegExp(`^#{1,${level}} `, "m").exec(rest);
  const end = next ? start + anchor.length + next.index : source.text.length;
  return source.text.slice(start, Math.min(end, start + MAX_EXCERPT));
}

// Resolves each step's excerpt in plan order: a step's anchor is searched
// for starting where the previous step's anchor was found, so lessons that
// reuse the same heading text (e.g. several "### Пример" sections) resolve
// each step to its OWN occurrence instead of all collapsing onto the first
// one. A step whose anchor isn't found from the cursor onward falls back to
// searching the whole document from the top; if it's not found at all,
// excerptForStep's own head-of-document fallback applies, exactly as before.
export function resolveStepExcerpts(source: LessonSource, steps: StepMeta[]): Map<string, string> {
  const excerpts = new Map<string, string>();
  let cursor = 0;

  for (const meta of steps) {
    const anchor = meta.source_anchor;
    if (!anchor) {
      excerpts.set(meta.id, excerptForStep(source, undefined));
      continue;
    }

    let pos = locateAnchor(source.text, anchor, cursor);
    if (pos === -1) pos = locateAnchor(source.text, anchor, 0);

    excerpts.set(meta.id, excerptForStep(source, anchor, pos === -1 ? 0 : pos));
    if (pos !== -1) cursor = pos + anchor.length;
  }

  return excerpts;
}

const FENCE_OPEN = /^(`{3,})(?:markdown|md)?\s*$/i;

/**
 * Removes a code fence that wraps the WHOLE reply.
 *
 * Agents sometimes answer "here is the markdown" by putting the entire body
 * inside a ```markdown fence; written verbatim, the step then renders as one
 * monospace block instead of prose (020-identity.md and 027-broadcasting.md
 * were committed that way).
 *
 * Deliberately conservative, because a body may legitimately start with a code
 * block: the opening fence must carry no language or `markdown`/`md`, the last
 * line must close it, and the fence lines in between must come in pairs — so
 * a body whose own first and last blocks are fenced code is left alone.
 */
export function stripEnclosingFence(body: string): string {
  const trimmed = body.trim();
  const lines = trimmed.split("\n");
  if (lines.length < 2) return trimmed;

  const open = FENCE_OPEN.exec(lines[0].trim());
  if (!open) return trimmed;
  if (!new RegExp(`^\`{${open[1].length},}$`).test(lines[lines.length - 1].trim())) return trimmed;

  const inner = lines.slice(1, -1);
  const innerFences = inner.filter((line) => /^`{3,}/.test(line.trim())).length;
  if (innerFences % 2 !== 0) return trimmed;

  return inner.join("\n").trim();
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
  const excerpts = resolveStepExcerpts(source, plan.steps);
  const written: string[] = [];

  for (const [offset, meta] of window.entries()) {
    if (readStep(contentDir, plan.slug, meta.id)) continue;

    const prompt = renderPrompt("write-step", {
      lesson_title: plan.title,
      step_title: meta.title,
      step_type: meta.type,
      neighbours: neighbourSummary(plan, fromIndex + offset),
      source_excerpt: excerpts.get(meta.id) ?? excerptForStep(source, meta.source_anchor),
    });

    const body = stripEnclosingFence(await deps.run(prompt, onEvent));
    const step: Step = { ...meta, body };
    writeStep(contentDir, plan.slug, step);
    written.push(meta.id);
  }

  return written;
}
