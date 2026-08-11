import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export type GitRunner = (args: string[], cwd: string) => string;

const execGit: GitRunner = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export interface UpstreamOptions {
  dir: string;
  remote: string;
  branch: string;
  maxAgeMs: number;
  now?: number;
  git?: GitRunner;
}

export interface UpstreamResult {
  dir: string;
  /** Короткий SHA головы кэша, null — если прочитать не вышло. */
  head: string | null;
  fetched: boolean;
  fetchedAt: number | null;
  /** Апстрим опросить не удалось, но кэш на месте и им можно пользоваться. */
  error?: string;
}

/**
 * Метка последнего опроса апстрима — файл РЯДОМ с каталогом клона, а не
 * `.git/FETCH_HEAD` внутри него: после `clone` FETCH_HEAD не создаётся, и
 * случай «только что склонировали» пришлось бы отличать особым правилом.
 */
function markerPath(dir: string): string {
  return `${dir}.fetched`;
}

function lastFetchAt(dir: string): number | null {
  const marker = markerPath(dir);
  return fs.existsSync(marker) ? fs.statSync(marker).mtimeMs : null;
}

function markFetched(dir: string, now: number): void {
  fs.writeFileSync(markerPath(dir), `${new Date(now).toISOString()}\n`, "utf8");
}

export function hasClone(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".git"));
}

function readHead(dir: string, git: GitRunner): string | null {
  try {
    return git(["rev-parse", "--short", "HEAD"], dir).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Приводит кэш-клон курса в актуальное состояние и возвращает путь к нему.
 *
 * `reset --hard` здесь безопасен по построению: каталог создан лабой, в него
 * никто не пишет, локальных правок в нём быть не может. Репозиторий
 * пользователя из COURSE_REPO не участвует ни в одной команде — именно ради
 * этого кэш и заведён: у форка грязное рабочее дерево и своя ветка.
 */
export function ensureUpstream(options: UpstreamOptions): UpstreamResult {
  const { dir, remote, branch, maxAgeMs } = options;
  const git = options.git ?? execGit;
  const now = options.now ?? Date.now();

  if (!hasClone(dir)) {
    const parent = path.dirname(dir);
    fs.mkdirSync(parent, { recursive: true });
    try {
      git(["clone", "--depth", "1", "--single-branch", "--branch", branch, remote, dir], parent);
    } catch (error) {
      // Оборванный clone оставляет каталог без рабочего репозитория, а он
      // выглядит для hasClone() как готовый кэш. Лучше пустое место.
      fs.rmSync(dir, { recursive: true, force: true });
      throw error;
    }
    markFetched(dir, now);
    return { dir, head: readHead(dir, git), fetched: true, fetchedAt: now };
  }

  const at = lastFetchAt(dir);
  if (at !== null && now - at < maxAgeMs) {
    return { dir, head: readHead(dir, git), fetched: false, fetchedAt: at };
  }

  try {
    git(["fetch", "--depth", "1", "origin", branch], dir);
    git(["reset", "--hard", "FETCH_HEAD"], dir);
  } catch (error) {
    return { dir, head: readHead(dir, git), fetched: false, fetchedAt: at, error: (error as Error).message };
  }

  markFetched(dir, now);
  return { dir, head: readHead(dir, git), fetched: true, fetchedAt: now };
}
