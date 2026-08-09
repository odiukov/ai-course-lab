import type { Config } from "../config";
import type { GenerateDeps } from "../generate/plan-lesson";
import { claudeAdapter } from "./claude-adapter";
import { codexAdapter } from "./codex-adapter";
import { runQueued } from "./runner";

export function defaultDeps(config: Config): GenerateDeps {
  const adapter = config.agent === "codex" ? codexAdapter : claudeAdapter;
  return {
    run: (prompt, onEvent) => runQueued({ adapter, prompt }, onEvent),
  };
}
