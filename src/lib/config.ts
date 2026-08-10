import fs from "node:fs";
import path from "node:path";

export interface Config {
  sourceDir: string;
  courseRepo: string | null;
  contentDir: string;
  dataDir: string;
  agent: "claude" | "codex";
  /** Интерпретатор для pytest и замера. */
  python: string;
  /** Порт моста pyright-langserver. */
  lspPort: number;
}

export function isDirectory(candidate: string): boolean {
  return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const root = process.cwd();

  // A stale COURSE_REPO is treated exactly like an unset one: null, no throw.
  // loadConfig() runs on every read path (catalog page, lesson API, visual
  // route), and the old repository is legacy by design — moving it away must
  // not 500 an app whose lessons all live in source/. The importer, which
  // genuinely cannot work without it, refuses to run on its own.
  let courseRepo: string | null = null;
  if (env.COURSE_REPO) {
    const resolved = path.resolve(env.COURSE_REPO);
    if (isDirectory(resolved)) courseRepo = resolved;
  }

  return {
    sourceDir: path.join(root, "source"),
    courseRepo,
    contentDir: path.join(root, "content"),
    dataDir: path.join(root, "data"),
    agent: env.AGENT === "codex" ? "codex" : "claude",
    python: env.PYTHON?.trim() || "python3",
    lspPort: Number.isInteger(Number(env.LSP_PORT)) && Number(env.LSP_PORT) > 0
      ? Number(env.LSP_PORT)
      : 3001,
  };
}
