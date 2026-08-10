import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PracticeError } from "./errors";
import { parseJunitXml, type TestOutcome } from "./junit";

export const TESTS_TIMEOUT_MS = 60_000;

export interface RunTestsOptions {
  dir: string;
  fn?: string;
  python?: string;
  timeoutMs?: number;
}

export interface TestRunResult extends TestOutcome {
  /** Гонялся ли только набор текущей функции. */
  filtered: boolean;
  warning: string | null;
  command: string;
  stdout: string;
}

interface RawRun {
  code: number | null;
  stdout: string;
  stderr: string;
  xml: string | null;
}

function spawnPytest(opts: {
  python: string;
  dir: string;
  fn?: string;
  timeoutMs: number;
}): Promise<RawRun> {
  const junit = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "lab-junit-")),
    "report.xml",
  );
  const args = ["-m", "pytest", "-q", "--no-header", "--junit-xml", junit];
  if (opts.fn) args.push("-k", opts.fn);

  return new Promise((resolve, reject) => {
    const child = spawn(opts.python, args, { cwd: opts.dir, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new PracticeError(
          `Прогон тестов не закончился за ${Math.round(opts.timeoutMs / 1000)} с и был прерван`,
          "timeout",
        ),
      );
    }, opts.timeoutMs);
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
      reject(new PracticeError(`Не удалось запустить ${opts.python}: ${error.message}`, "spawn"));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr,
        xml: fs.existsSync(junit) ? fs.readFileSync(junit, "utf8") : null,
      });
    });
  });
}

function toOutcome(run: RawRun, python: string): TestOutcome {
  if (run.xml === null) {
    // Ни отчёта, ни тестов: интерпретатор не дошёл до прогона. Единственный
    // случай, когда виноват не код учащегося, а окружение.
    const reason = (run.stderr || run.stdout).trim().split("\n").slice(-3).join(" ");
    throw new PracticeError(
      `${python} не оставил junit-отчёта (код ${run.code}). ${reason}`,
      "python",
    );
  }
  try {
    return parseJunitXml(run.xml);
  } catch (error) {
    throw new PracticeError(`Не удалось разобрать junit-отчёт: ${(error as Error).message}`, "output");
  }
}

export async function runTests(options: RunTestsOptions): Promise<TestRunResult> {
  const python = options.python ?? "python3";
  const timeoutMs = options.timeoutMs ?? TESTS_TIMEOUT_MS;
  const describe = (fn?: string) =>
    `${python} -m pytest -q --no-header${fn ? ` -k ${fn}` : ""}`;

  const first = toOutcome(
    await spawnPytest({ python, dir: options.dir, fn: options.fn, timeoutMs }),
    python,
  );

  if (!options.fn || first.total > 0) {
    return {
      ...first,
      filtered: Boolean(options.fn),
      warning: null,
      command: describe(options.fn),
      stdout: "",
    };
  }

  // Соглашение об именах тестов нарушено в этом упражнении: фильтр не выбрал
  // ничего. Молча показать «0 из 0 зелёные» нельзя, гнать пустоту тоже —
  // гоняем весь файл и говорим об этом прямым текстом.
  const full = toOutcome(await spawnPytest({ python, dir: options.dir, timeoutMs }), python);
  return {
    ...full,
    filtered: false,
    warning: `Фильтр -k ${options.fn} не выбрал ни одного теста — прогнан весь файл. Похоже, тесты этого упражнения названы не по образцу test_<функция>_<случай>.`,
    command: describe(undefined),
    stdout: "",
  };
}
