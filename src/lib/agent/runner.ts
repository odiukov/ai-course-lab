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
    let failure: Error | null = null;
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      for (const event of opts.adapter.parseLine(line)) {
        events.push(event);
        onEvent(event);
        if (event.type === "limit") {
          failure = new Error(`Упёрлись в лимит подписки: ${event.message}`);
        } else if (event.type === "error" && !failure) {
          failure = new Error(event.message);
        }
      }
    });

    child.on("error", (error) => {
      reject(new Error(`Не удалось запустить ${opts.adapter.command}: ${error.message}`));
    });

    child.on("close", (code) => {
      if (failure) return reject(failure);
      if (code !== 0) {
        return reject(new Error(`${opts.adapter.command} вышел с кодом ${code}. ${stderr.trim()}`));
      }
      resolve(collectText(events));
    });
  });
}

export function runQueued(
  opts: RunOptions,
  onEvent: (event: AgentEvent) => void,
): Promise<string> {
  return enqueue(() => runAgent(opts, onEvent));
}
