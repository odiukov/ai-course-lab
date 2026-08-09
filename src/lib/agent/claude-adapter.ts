import { isLimitMessage, safeJson, type Adapter, type AgentEvent } from "./events";

// Format observed in tests/fixtures/agent/claude-stream.jsonl, recorded from a real
// `claude -p ... --output-format stream-json --verbose` run (Task 7):
//   {"type":"system","subtype":"hook_started"|"hook_response"|"init", ...}   -- local-machine
//     hook/session noise, no answer text, skipped by falling through to [].
//   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
//   {"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning", ...}}
//     -- a status report ("this call is allowed, here's a warning"), not proof the
//     limit was reached. It appeared during a completely successful run, so it is
//     ignored here; a genuine limit is caught via the "result" branch below using
//     is_error + isLimitMessage instead.
//   {"type":"result","subtype":"success","is_error":false,"result":"...", ...}
export const claudeAdapter: Adapter = {
  command: "claude",
  args: (prompt) => ["-p", prompt, "--output-format", "stream-json", "--verbose"],
  parseLine(line) {
    const data = safeJson(line);
    if (!data) return [];

    if (data.type === "assistant") {
      const message = data.message as { content?: { type: string; text?: string }[] } | undefined;
      const chunks = (message?.content ?? [])
        .filter((part) => part.type === "text" && part.text)
        .map((part): AgentEvent => ({ type: "text", text: part.text as string }));
      return chunks;
    }

    if (data.type === "result") {
      const text = typeof data.result === "string" ? data.result : "";
      if (data.is_error) {
        return [{ type: isLimitMessage(text) ? "limit" : "error", message: text || "Агент вернул ошибку" }];
      }
      return [{ type: "done", text }];
    }

    return [];
  },
};
