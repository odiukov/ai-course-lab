import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { collectText, type Adapter, type AgentEvent } from "./events";
import { enqueue, queueDepth } from "./queue";

export { queueDepth };

export interface RunOptions {
  adapter: Adapter;
  prompt: string;
  cwd?: string;
  signal?: AbortSignal;
  /** Hard cap on one run. 0 disables it. Defaults to DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
}

// A wedged CLI used to hold the serial queue for the lifetime of the dev
// server: no timeout anywhere, so every later generation in every tab waited
// on it. Ten minutes is far above a real plan generation (minutes at worst)
// and far below "until you restart".
export const DEFAULT_TIMEOUT_MS = 10 * 60_000;

export type AgentRunErrorKind =
  | "limit"
  | "agent"
  | "spawn"
  | "exit"
  | "parse"
  | "aborted"
  | "timeout";

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

/**
 * An empty directory outside the repository, used as the agent's cwd.
 *
 * Spawned with an undefined cwd the agent inherited the dev server's working
 * directory — this repository, with the whole course in it. The prompts
 * interpolate lesson bodies verbatim and this curriculum contains lessons
 * about prompt injection, so the agent must not be standing in the course
 * while it reads them.
 */
export function agentScratchDir(): string {
  const dir = path.join(os.tmpdir(), "ai-course-lab-agent");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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
      cwd: opts.cwd ?? agentScratchDir(),
      signal: opts.signal,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const events: AgentEvent[] = [];
    let failure: AgentRunError | null = null;
    let stderr = "";
    let settled = false;

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            // Kill first, settle second: the promise must not resolve while a
            // wedged child is still holding the queue.
            child.kill("SIGKILL");
            settleReject(
              new AgentRunError(
                `${opts.adapter.command} не ответил за ${Math.round(timeoutMs / 1000)} с — запуск прерван`,
                "timeout",
              ),
            );
          }, timeoutMs)
        : null;
    timer?.unref?.();

    function settleResolve(text: string) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(text);
    }

    function settleReject(error: AgentRunError) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
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
