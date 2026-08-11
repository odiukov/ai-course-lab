import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureUpstream, hasClone } from "./upstream";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "upstream-"));
}

/** Каталог кэша, которого ещё нет: ensureUpstream должен его склонировать. */
function freshTarget(): string {
  return path.join(tmpDir(), "course-repo");
}

/** Уже «склонированный» кэш: .git на месте, метка свежести с заданным возрастом. */
function clonedTarget(ageMs: number | null): string {
  const dir = path.join(tmpDir(), "course-repo");
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  if (ageMs !== null) {
    const marker = `${dir}.fetched`;
    fs.writeFileSync(marker, "x", "utf8");
    const at = new Date(Date.now() - ageMs);
    fs.utimesSync(marker, at, at);
  }
  return dir;
}

function recorder(head = "abc1234") {
  const calls: { args: string[]; cwd: string }[] = [];
  const git = (args: string[], cwd: string): string => {
    calls.push({ args, cwd });
    return args[0] === "rev-parse" ? head : "";
  };
  return { calls, git };
}

const REMOTE = "https://example.invalid/course.git";

describe("ensureUpstream", () => {
  it("клонирует, когда каталога кэша ещё нет", () => {
    const dir = freshTarget();
    const { calls, git } = recorder();

    const result = ensureUpstream({ dir, remote: REMOTE, branch: "main", maxAgeMs: 1000, git });

    expect(calls[0].args).toEqual([
      "clone", "--depth", "1", "--single-branch", "--branch", "main", REMOTE, dir,
    ]);
    expect(result.fetched).toBe(true);
    expect(result.head).toBe("abc1234");
    expect(fs.existsSync(`${dir}.fetched`)).toBe(true);
  });

  it("обновляет кэш, когда метка протухла", () => {
    const dir = clonedTarget(10 * 60_000);
    const { calls, git } = recorder();

    const result = ensureUpstream({ dir, remote: REMOTE, branch: "main", maxAgeMs: 5 * 60_000, git });

    expect(calls.map((call) => call.args[0])).toEqual(["fetch", "reset", "rev-parse"]);
    expect(calls[0].args).toEqual(["fetch", "--depth", "1", "origin", "main"]);
    expect(calls[1].args).toEqual(["reset", "--hard", "FETCH_HEAD"]);
    expect(calls[1].cwd).toBe(dir);
    expect(result.fetched).toBe(true);
  });

  it("не ходит в сеть, пока метка свежая", () => {
    const dir = clonedTarget(30_000);
    const { calls, git } = recorder();

    const result = ensureUpstream({ dir, remote: REMOTE, branch: "main", maxAgeMs: 5 * 60_000, git });

    expect(calls.map((call) => call.args[0])).toEqual(["rev-parse"]);
    expect(result.fetched).toBe(false);
    expect(result.fetchedAt).not.toBeNull();
  });

  // Устаревший курс лучше, чем неработающая кнопка: упавший fetch при живом
  // клоне отдаётся полем error, а не исключением.
  it("переживает упавший fetch, если клон на месте", () => {
    const dir = clonedTarget(10 * 60_000);
    const git = (args: string[]): string => {
      if (args[0] === "fetch") throw new Error("сеть недоступна");
      return "abc1234";
    };

    const result = ensureUpstream({ dir, remote: REMOTE, branch: "main", maxAgeMs: 1000, git });

    expect(result.error).toContain("сеть недоступна");
    expect(result.fetched).toBe(false);
    expect(result.dir).toBe(dir);
  });

  it("бросает, если клона нет и склонировать не вышло", () => {
    const dir = freshTarget();
    const git = (): string => {
      throw new Error("сеть недоступна");
    };

    expect(() => ensureUpstream({ dir, remote: REMOTE, branch: "main", maxAgeMs: 1000, git }))
      .toThrow(/сеть недоступна/);
  });

  // Оборванный clone оставляет каталог, в котором нет рабочего репозитория.
  // Если его не убрать, следующий вызов увидит hasClone() и пойдёт делать
  // fetch в пустоте — вместо того чтобы просто попробовать клонировать снова.
  it("убирает за собой каталог после неудачного clone", () => {
    const dir = freshTarget();
    const git = (args: string[]): string => {
      fs.mkdirSync(dir, { recursive: true });
      throw new Error(`оборвалось на ${args[0]}`);
    };

    expect(() => ensureUpstream({ dir, remote: REMOTE, branch: "main", maxAgeMs: 1000, git })).toThrow();
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe("hasClone", () => {
  it("отличает готовый клон от пустого места", () => {
    expect(hasClone(freshTarget())).toBe(false);
    expect(hasClone(clonedTarget(0))).toBe(true);
  });
});
