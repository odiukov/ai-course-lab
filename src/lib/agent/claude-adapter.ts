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
  // `--tools ""` disables every built-in tool (verified against claude 2.1.226:
  // the `system`/`init` line comes back with "tools":[]), and
  // `--strict-mcp-config` with no --mcp-config leaves "mcp_servers":[] so no
  // MCP server can add tools back. The spec requires an agent that returns
  // text only and physically cannot touch the course.
  // `--include-partial-messages` is what makes the chat answer appear as it is
  // written. Without it claude emits one `assistant` line carrying the finished
  // message, so the panel sat empty and then printed everything at once.
  args: (prompt) => [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools",
    "",
    "--strict-mcp-config",
  ],
  parseLine(line) {
    const data = safeJson(line);
    if (!data) return [];

    // Text comes only from the deltas (recorded in claude-partial-stream.jsonl:
    // "гот" + "ово"). The `assistant` line repeats the same text complete, and
    // emitting both would print every answer twice in a UI that concatenates
    // text events. `thinking_delta` is skipped: it is not the answer.
    if (data.type === "stream_event") {
      const event = data.event as
        | { type?: string; delta?: { type?: string; text?: string } }
        | undefined;
      if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
        const text = event.delta.text ?? "";
        return text ? [{ type: "text", text } as AgentEvent] : [];
      }
      return [];
    }

    if (data.type === "result") {
      const text = typeof data.result === "string" ? data.result : "";
      if (data.is_error) {
        // The recorded fixture's only "result" line has is_error: false — a genuine
        // non-limit failure (the "error" branch below) was never observed in Task 7's
        // recording and is NOT verified against real CLI output.
        return [{ type: isLimitMessage(text) ? "limit" : "error", message: text || "Агент вернул ошибку" }];
      }
      return [{ type: "done", text }];
    }

    return [];
  },
};
