import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import { PracticeError } from "./errors";

export const BENCH_TIMEOUT_MS = 120_000;

const metricsSchema = z.object({
  lines: z.number(),
  loops: z.number(),
  depth: z.number(),
  branches: z.number(),
  us: z.number().nullable(),
});

const reportSchema = z.object({
  exercise: z.string(),
  functions: z.array(
    z.object({
      fn: z.string(),
      written: z.boolean(),
      mine: metricsSchema.nullable(),
      ref: metricsSchema,
      ratio: z.number().nullable(),
      status: z.enum(["ok", "slow", "very-slow", "unknown"]),
    }),
  ),
  ruff: z.object({
    available: z.boolean(),
    findings: z.array(z.object({ code: z.string(), line: z.number(), message: z.string() })),
  }),
});

export type FnMetrics = z.infer<typeof metricsSchema>;
export type BenchReport = z.infer<typeof reportSchema>;
export type BenchRow = BenchReport["functions"][number];

export function parseBenchOutput(stdout: string): BenchReport {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    const tail = stdout.trim().split("\n").slice(-2).join(" ");
    throw new PracticeError(`Скрипт замера ответил не JSON: ${tail}`, "output");
  }
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PracticeError(
      `Отчёт замера не той формы: ${parsed.error.issues[0]?.message ?? "неизвестно"}`,
      "output",
    );
  }
  return parsed.data;
}

export function runBench(options: {
  dir: string;
  fn?: string;
  python?: string;
  timeoutMs?: number;
}): Promise<BenchReport> {
  const python = options.python ?? "python3";
  const timeoutMs = options.timeoutMs ?? BENCH_TIMEOUT_MS;
  const args = [path.join(process.cwd(), "scripts", "bench.py"), options.dir];
  if (options.fn) args.push("--fn", options.fn);

  return new Promise((resolve, reject) => {
    const child = spawn(python, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new PracticeError("Замер не уложился в таймаут и был прерван", "timeout"));
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new PracticeError(`Не удалось запустить ${python}: ${error.message}`, "spawn"));
    });

    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        resolve(parseBenchOutput(stdout));
      } catch (error) {
        const detail = stderr.trim().split("\n").slice(-2).join(" ");
        reject(
          error instanceof PracticeError && detail
            ? new PracticeError(`${error.message} ${detail}`, error.kind)
            : error,
        );
      }
    });
  });
}
