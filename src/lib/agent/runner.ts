import { spawn } from "node:child_process";
import readline from "node:readline";
import { collectText, type Adapter, type AgentEvent } from "./events";
import { enqueue, queueDepth } from "./queue";

export { queueDepth };

export interface RunOptions {
  adapter: Adapter;
  prompt: string;
  cwd?: string;
  signal?: AbortSignal;
}

export type AgentRunErrorKind = "limit" | "agent" | "spawn" | "exit" | "parse" | "aborted";

export class AgentRunError extends Error {
  kind: AgentRunErrorKind;

  constructor(message: string, kind: AgentRunErrorKind) {
    super(message);
    this.name = "AgentRunError";
    this.kind = kind;
  }
}

const LINE_EXCERPT_LIMIT = 200;

function excerpt(line: string): string {
  return line.length > LINE_EXCERPT_LIMIT ? `${line.slice(0, LINE_EXCERPT_LIMIT)}…` : line;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function runAgent(
  opts: RunOptions,
  onEvent: (event: AgentEvent) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.adapter.command, opts.adapter.args(opts.prompt), {
      cwd: opts.cwd,
      signal: opts.signal,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const events: AgentEvent[] = [];
    let failure: AgentRunError | null = null;
    let stderr = "";
    let settled = false;

    function settleResolve(text: string) {
      if (settled) return;
      settled = true;
      resolve(text);
    }

    function settleReject(error: AgentRunError) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (settled) return;
      try {
        for (const event of opts.adapter.parseLine(line)) {
          events.push(event);
          onEvent(event);
          if (event.type === "limit") {
            failure = new AgentRunError(`Упёрлись в лимит подписки: ${event.message}`, "limit");
          } else if (event.type === "error" && !failure) {
            failure = new AgentRunError(event.message, "agent");
          }
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        child.kill();
        settleReject(
          new AgentRunError(
            `${opts.adapter.command} вернул строку, которую не удалось разобрать: ${reason}. Строка: ${excerpt(line)}`,
            "parse",
          ),
        );
      }
    });

    child.on("error", (error) => {
      if (opts.signal?.aborted || isAbortError(error)) {
        settleReject(new AgentRunError(`Запуск ${opts.adapter.command} отменён`, "aborted"));
        return;
      }
      settleReject(new AgentRunError(`Не удалось запустить ${opts.adapter.command}: ${error.message}`, "spawn"));
    });

    child.on("close", (code) => {
      if (settled) return;
      if (opts.signal?.aborted) {
        settleReject(new AgentRunError(`Запуск ${opts.adapter.command} отменён`, "aborted"));
        return;
      }
      if (failure) return settleReject(failure);
      if (code !== 0) {
        return settleReject(
          new AgentRunError(`${opts.adapter.command} вышел с кодом ${code}. ${stderr.trim()}`, "exit"),
        );
      }
      settleResolve(collectText(events));
    });
  });
}

export function runQueued(
  opts: RunOptions,
  onEvent: (event: AgentEvent) => void,
): Promise<string> {
  return enqueue(() => runAgent(opts, onEvent));
}
