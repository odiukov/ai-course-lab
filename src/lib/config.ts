import fs from "node:fs";
import path from "node:path";

export interface Config {
  sourceDir: string;
  courseRepo: string | null;
  contentDir: string;
  dataDir: string;
  agent: "claude" | "codex";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const root = process.cwd();

  let courseRepo: string | null = null;
  if (env.COURSE_REPO) {
    const resolved = path.resolve(env.COURSE_REPO);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Директория курса для импорта не найдена: ${resolved}`);
    }
    courseRepo = resolved;
  }

  return {
    sourceDir: path.join(root, "source"),
    courseRepo,
    contentDir: path.join(root, "content"),
    dataDir: path.join(root, "data"),
    agent: env.AGENT === "codex" ? "codex" : "claude",
  };
}
