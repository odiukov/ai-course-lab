import type { Config } from "../config";
import type { GenerateDeps } from "../generate/plan-lesson";
import type { AgentName } from "../progress/settings";
import { isTransientError } from "./error-message";
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

/** Пауза перед повтором: провайдеру нужно время разгрузиться. */
const RETRY_DELAY_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function defaultDeps(config: Config, options: DepsOptions = {}): GenerateDeps {
  const agent = options.agent ?? config.agent;
  const adapter = agent === "codex" ? codexAdapter : claudeAdapter;
  const run = (prompt: string, onEvent: Parameters<GenerateDeps["run"]>[1]) =>
    runQueued({ adapter, prompt, signal: options.signal, timeoutMs: options.timeoutMs }, onEvent);

  return {
    /**
     * Один повтор на временной поломке провайдера.
     *
     * «529 Overloaded» и обрыв потока на полуслове — не про этот промпт, но
     * отменяли весь урок: из тридцати трёх шагов на диске оставалось два, и
     * урок приходилось прогонять отдельным проходом. Повтор один: если
     * провайдер лежит всерьёз, второй заход только съест квоту, а очередь и так
     * встанет по трём таймаутам подряд.
     */
    run: async (prompt, onEvent) => {
      try {
        return await run(prompt, onEvent);
      } catch (error) {
        if (!isTransientError(error)) throw error;
        onEvent({
          type: "text",
          text: `Временная ошибка провайдера, повтор через ${RETRY_DELAY_MS / 1000} с: ${(error as Error).message}`,
        });
        await sleep(RETRY_DELAY_MS);
        return run(prompt, onEvent);
      }
    },
  };
}
