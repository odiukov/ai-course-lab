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

export function collectText(events: AgentEvent[]): string {
  const done = events.find((event) => event.type === "done");
  if (done && done.type === "done" && done.text.trim()) return done.text;
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
