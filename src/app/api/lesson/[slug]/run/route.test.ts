import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeProgressDb, openProgressDb } from "@/lib/progress/db";
import { lastTestRun } from "@/lib/progress/tests";
import type { LessonRef } from "@/lib/source/catalog";

const ref: LessonRef = {
  slug: "19-capstone-projects__76-collectives",
  phaseDir: "19-capstone-projects",
  lessonDir: "76-collectives",
  phaseNumber: 19,
  lessonNumber: 76,
  title: "Collectives",
};

let sourceDir = "";
let dataDir = "";
let packageOk = true;
let runResult = {
  passed: true,
  exitCode: 0,
  command: "python3 main.py",
  stdout: "workers converged\n",
  stderr: "",
};

vi.mock("@/lib/config", () => ({
  loadConfig: () => ({ sourceDir, contentDir: "/unused", dataDir, python: "python3" }),
}));
vi.mock("@/lib/source/catalog", () => ({ findLesson: () => ref }));
vi.mock("@/lib/content/step-file", () => ({
  readStep: () => ({
    id: "009-run",
    type: "run",
    title: "Запуск",
    run_file: "main.py",
    body: "",
  }),
}));
vi.mock("@/lib/practice/run-script", () => ({
  runScript: vi.fn(async () => runResult),
}));
vi.mock("@/lib/practice/health", () => ({
  probePythonModule: vi.fn(async (_python: string, name: string) =>
    packageOk
      ? { ok: true, detail: "установлен" }
      : { ok: false, detail: `модуль ${name} не найден в python3` }),
}));

const { POST } = await import("./route");
const { runScript } = await import("@/lib/practice/run-script");
const runScriptMock = vi.mocked(runScript);
const params = { params: Promise.resolve({ slug: ref.slug }) };

function request(body: unknown): Request {
  return new Request(`http://localhost/api/lesson/${ref.slug}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeExercise(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lab-run-route-"));
  const dir = path.join(root, "learning-exercises", "p19-l76-collectives");
  fs.mkdirSync(path.join(dir, "exercise.template"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "exercise.template", "main.py"),
    "def converge():\n    raise NotImplementedError\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "exercise.json"),
    JSON.stringify({
      version: 1,
      run: { file: "main.py", args: [], timeoutMs: 120000 },
      requirements: ["torch"],
      targets: [{ file: "main.py", symbol: "converge", tests: [], bench: false }],
    }),
    "utf8",
  );
  return root;
}

describe("POST /api/lesson/[slug]/run", () => {
  beforeEach(() => {
    sourceDir = makeExercise();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-run-route-data-"));
    runResult = {
      passed: true,
      exitCode: 0,
      command: "python3 main.py",
      stdout: "workers converged\n",
      stderr: "",
    };
    packageOk = true;
    runScriptMock.mockClear();
  });

  afterEach(() => {
    closeProgressDb(dataDir);
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("пишет зелёный script-зачёт в test_runs под именем файла", async () => {
    const response = await POST(request({ stepId: "009-run" }), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "passed", result: { exitCode: 0 } });

    expect(lastTestRun(openProgressDb(dataDir), ref.slug, "009-run")).toMatchObject({
      exerciseFn: "main.py",
      passed: 1,
      failed: 0,
    });
  });

  it("ненулевой код красит только run-шаг и сохраняет хвост stderr", async () => {
    runResult = {
      passed: false,
      exitCode: 2,
      command: "python3 main.py",
      stdout: "",
      stderr: "rank 3 diverged\n",
    };
    const response = await POST(request({ stepId: "009-run" }), params);
    expect((await response.json()).state).toBe("failed");
    expect(lastTestRun(openProgressDb(dataDir), ref.slug, "009-run")).toMatchObject({
      exerciseFn: "main.py",
      passed: 0,
      failed: 1,
      firstFailure: "rank 3 diverged",
    });
  });

  it("отсутствующая зависимость не запускает скрипт и не красит шаг", async () => {
    packageOk = false;
    const response = await POST(request({ stepId: "009-run" }), params);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ kind: "python", error: expect.stringContaining("torch") });
    expect(runScriptMock).not.toHaveBeenCalled();
    expect(lastTestRun(openProgressDb(dataDir), ref.slug, "009-run")).toBeNull();
  });
});
