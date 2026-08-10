import type { AgentEvent } from "../agent/events";
import { renderPrompt } from "../agent/prompts";
import type { Step } from "../content/step-file";
import type { GenerateDeps } from "./plan-lesson";
import { stripEnclosingFence } from "./write-step";

export const MAX_STEP_BODY = 4000;

export interface ExplainRequest {
  lessonTitle: string;
  step: Step;
  clarifications: string;
  history: string;
  question: string;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

export function buildExplainPrompt(request: ExplainRequest): string {
  return renderPrompt("explain", {
    lesson_title: request.lessonTitle,
    step_title: request.step.title,
    step_type: request.step.type,
    step_body: truncate(request.step.body, MAX_STEP_BODY),
    clarifications: request.clarifications,
    history: request.history,
    question: request.question,
  });
}

export async function explainStep(opts: {
  request: ExplainRequest;
  deps: GenerateDeps;
  onEvent?: (event: AgentEvent) => void;
}): Promise<string> {
  const onEvent = opts.onEvent ?? (() => {});
  const raw = await opts.deps.run(buildExplainPrompt(opts.request), onEvent);
  // Same fence that written steps get: an agent asked for markdown sometimes
  // wraps the whole reply in ```markdown, and a chat answer written verbatim
  // into the clarifications layer would then render as one monospace block.
  const text = stripEnclosingFence(raw);
  if (text.length === 0) {
    throw new Error("Агент вернул пустой ответ — попробуй спросить ещё раз");
  }
  return text;
}
