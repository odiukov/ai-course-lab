import { spawn } from "node:child_process";
import path from "node:path";
import { PracticeError } from "./errors";

export const SCRIPT_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_CHARS = 256_000;

export interface RunScriptOptions {
  dir: string;
  file: string;
  args?: string[];
  python?: string;
  timeoutMs?: number;
}

export interface ScriptRunResult {
  passed: boolean;
  exitCode: number | null;
  command: string;
  stdout: string;
  stderr: string;
}

function appendOutput(current: string, chunk: unknown): string {
  const next = current + String(chunk);
  return next.length <= MAX_OUTPUT_CHARS ? next : next.slice(-MAX_OUTPUT_CHARS);
}

function stopProcessTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    // Лаборатории 76–81 поднимают несколько torch-воркеров. Убийство только
    // родителя оставляло их слушать порты после таймаута, поэтому процесс
    // запускается отдельной группой и здесь завершается вся группа сразу.
    process.kill(-pid, "SIGKILL");
  } catch {
    // Процесс мог успеть завершиться между таймером и kill — это не новая
    // ошибка прогона и отдельно сообщать о ней учащемуся не нужно.
  }
}

export function runScript(options: RunScriptOptions): Promise<ScriptRunResult> {
  const python = options.python ?? "python3";
  const timeoutMs = options.timeoutMs ?? SCRIPT_TIMEOUT_MS;
  const args = [options.file, ...(options.args ?? [])];
  const command = [python, path.basename(options.file), ...(options.args ?? [])].join(" ");

  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      cwd: options.dir,
      env: process.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stopProcessTree(child.pid);
      reject(
        new PracticeError(
          `Скрипт не закончил работу за ${Math.round(timeoutMs / 1000)} с и был прерван`,
          "timeout",
        ),
      );
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (chunk) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendOutput(stderr, chunk);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new PracticeError(`Не удалось запустить ${python}: ${error.message}`, "spawn"));
    });

    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        passed: exitCode === 0,
        exitCode,
        command,
        stdout,
        stderr,
      });
    });
  });
}
