import fs from "node:fs";
import path from "node:path";

export interface Config {
  courseRepo: string;
  contentDir: string;
  dataDir: string;
  agent: "claude" | "codex";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = env.COURSE_REPO;
  if (!raw) {
    throw new Error("COURSE_REPO не задан — пропиши путь к репозиторию курса в .env.local");
  }
  const courseRepo = path.resolve(raw);
  if (!fs.existsSync(courseRepo) || !fs.statSync(courseRepo).isDirectory()) {
    throw new Error(`Директория курса не найдена: ${courseRepo}`);
  }
  const agent = env.AGENT === "codex" ? "codex" : "claude";
  const root = process.cwd();
  return {
    courseRepo,
    contentDir: path.join(root, "content"),
    dataDir: path.join(root, "data"),
    agent,
  };
}
