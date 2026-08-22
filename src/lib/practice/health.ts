import { spawn } from "node:child_process";
import type { Config } from "../config";

export interface ToolStatus {
  ok: boolean;
  detail: string;
}

export interface PracticeHealth {
  python: ToolStatus;
  pytest: ToolStatus;
  ruff: ToolStatus;
  lsp: ToolStatus;
  packages: Record<string, ToolStatus>;
  networkRequired: boolean;
}

export const PROBE_TIMEOUT_MS = 5000;

export function probeCommand(
  command: string,
  args: string[],
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ToolStatus> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let settled = false;

    const finish = (status: ToolStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, detail: `${command}: таймаут проверки` });
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", (error) => finish({ ok: false, detail: error.message }));
    child.on("close", (code) =>
      finish({
        ok: code === 0,
        detail: output.trim().split("\n")[0] ?? `код ${code}`,
      }),
    );
  });
}

export async function probePythonModule(python: string, name: string): Promise<ToolStatus> {
  const status = await probeCommand(python, [
    "-c",
    "import importlib.util,sys; raise SystemExit(0 if importlib.util.find_spec(sys.argv[1]) else 1)",
    name,
  ]);
  return status.ok
    ? { ok: true, detail: "установлен" }
    : { ok: false, detail: `модуль ${name} не найден в ${python}` };
}

export async function checkPractice(
  config: Config,
  requirements: string[] = [],
  networkRequired = false,
): Promise<PracticeHealth> {
  const [python, pytest, ruff] = await Promise.all([
    probeCommand(config.python, ["--version"]),
    probeCommand(config.python, ["-m", "pytest", "--version"]),
    probeCommand("uvx", ["ruff", "--version"]),
  ]);
  const packageEntries = await Promise.all(
    [...new Set(requirements)].sort().map(async (name) => {
      return [name, await probePythonModule(config.python, name)] as const;
    }),
  );

  // Мост проверяется по HTTP с сервера, а не из браузера: так не нужен CORS, и
  // ответ приезжает одним запросом вместе с остальными инструментами.
  let lsp: ToolStatus;
  try {
    const response = await fetch(`http://127.0.0.1:${config.lspPort}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    lsp = response.ok
      ? { ok: true, detail: `порт ${config.lspPort}` }
      : { ok: false, detail: `мост ответил ${response.status}` };
  } catch (error) {
    lsp = { ok: false, detail: (error as Error).message };
  }

  return { python, pytest, ruff, lsp, packages: Object.fromEntries(packageEntries), networkRequired };
}
