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
  // `--disable <feature>` turns a tool surface off (verified against codex-cli
  // 0.147.0: `codex features list` reports shell_tool, browser_use and
  // computer_use as stable and on by default, an unknown name is rejected with
  // "Unknown feature flag", and a real run with all three disabled still
  // answers and still emits the item.completed shape parsed below). The shell
  // is the one that matters — the spec requires an agent that returns text
  // only and physically cannot touch the course; the browser and computer
  // surfaces go with it because they are the other ways out of the process.
  //
  // `-s read-only` stays as the second line of defence in case a later codex
  // build reaches a shell by some other path. `--skip-git-repo-check` is
  // required because the runner spawns it in a scratch directory that is not a
  // git repository.
  args: (prompt) => [
    "exec",
    "--json",
    "--disable",
    "shell_tool",
    "--disable",
    "browser_use",
    "--disable",
    "computer_use",
    "-s",
    "read-only",
    "--skip-git-repo-check",
    prompt,
  ],
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
