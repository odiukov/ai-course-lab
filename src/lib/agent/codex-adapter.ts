import { isLimitMessage, safeJson, type Adapter } from "./events";

// Format observed in tests/fixtures/agent/codex-stream.jsonl, recorded from a real
// `codex exec --json` run (Task 7):
//   {"type":"thread.started","thread_id":"..."}
//   {"type":"turn.started"}
//   {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
//   {"type":"turn.completed","usage":{...}}
//
// None of the recorded lines carry an error or a limit condition, so the branch
// below is written defensively from the shape of the other events and is NOT
// verified against real data.
export const codexAdapter: Adapter = {
  command: "codex",
  // codex-cli 0.147.0 has NO flag that disables tools: `codex exec --help`
  // offers only sandbox policies. `-s read-only` is therefore the strongest
  // restriction available — the agent may still read and run commands, but it
  // cannot write anywhere. `--skip-git-repo-check` is required because the
  // runner spawns it in a scratch directory that is not a git repository.
  args: (prompt) => ["exec", "--json", "-s", "read-only", "--skip-git-repo-check", prompt],
  parseLine(line) {
    const data = safeJson(line);
    if (!data) return [];

    const item = data.item as { type?: string; text?: string } | undefined;
    if (item?.type === "agent_message" && typeof item.text === "string") {
      return [{ type: "done", text: item.text }];
    }

    if (data.type === "error" || typeof data.error === "string") {
      const message = String(data.error ?? data.message ?? "Агент вернул ошибку");
      return [{ type: isLimitMessage(message) ? "limit" : "error", message }];
    }

    return [];
  },
};
