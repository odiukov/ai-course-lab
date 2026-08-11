import type { Config } from "../config";
import type { GenerateDeps } from "../generate/plan-lesson";
import type { AgentName } from "../progress/settings";
import { claudeAdapter } from "./claude-adapter";
import { codexAdapter } from "./codex-adapter";
import { runQueued } from "./runner";

export interface DepsOptions {
  /**
   * The request's abort signal. Without it a closed tab left the child running
   * and the serial queue blocked for the lifetime of the server process, so
   * every later generation in every tab hung until a restart.
   */
  signal?: AbortSignal;
  timeoutMs?: number;
  /**
   * Агент, выбранный в интерфейсе. Без него берётся AGENT из окружения:
   * маршрут, который про выбор не знает, продолжает работать как раньше.
   */
  agent?: AgentName;
}

export function defaultDeps(config: Config, options: DepsOptions = {}): GenerateDeps {
  const agent = options.agent ?? config.agent;
  const adapter = agent === "codex" ? codexAdapter : claudeAdapter;
  return {
    run: (prompt, onEvent) =>
      runQueued(
        { adapter, prompt, signal: options.signal, timeoutMs: options.timeoutMs },
        onEvent,
      ),
  };
}
