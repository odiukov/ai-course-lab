export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string }
  | { type: "limit"; message: string };

export interface Adapter {
  command: string;
  args(prompt: string): string[];
  parseLine(line: string): AgentEvent[];
}

/**
 * The agent's answer: the LAST non-empty `done`, falling back to the
 * concatenated streamed text.
 *
 * Last, not first. `claude` emits exactly one result line so the difference is
 * invisible there, but the codex adapter emits a `done` per completed agent
 * message and a multi-turn `codex exec` run emits several. Taking the first
 * one returns "let me look at the lesson" instead of the plan, extractJsonBlock
 * then finds no JSON, and the generation burns its retry and fails even though
 * the model answered correctly.
 */
export function collectText(events: AgentEvent[]): string {
  const done = events
    .filter((event): event is Extract<AgentEvent, { type: "done" }> => event.type === "done")
    .filter((event) => event.text.trim())
    .at(-1);
  if (done) return done.text;
  return events
    .filter((event): event is Extract<AgentEvent, { type: "text" }> => event.type === "text")
    .map((event) => event.text)
    .join("");
}

export function isLimitMessage(message: string): boolean {
  return /usage limit|rate limit|too many requests|limit reached/i.test(message);
}

export function safeJson(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}
