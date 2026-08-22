import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeProgressDb } from "@/lib/progress/db";
import type { LessonRef } from "@/lib/source/catalog";

// Урок с каталожным упражнением, где run объявлен и в main.py, и в hooks.py —
// именно такой дубль отключает фильтр -k (см. duplicateFunctions в tree.ts).
const duplicateRef: LessonRef = {
  slug: "19-capstone-projects__20-loop",
  phaseDir: "19-capstone-projects",
  lessonDir: "20-loop",
  phaseNumber: 19,
  lessonNumber: 20,
  title: "Loop",
};

let sourceDir = "";
let dataDir = "";

// Успешный путь мокает четыре точки: конфиг и урок (иначе тесту пришлось бы
// разворачивать настоящий курс), шаг (иначе — настоящий контент-каталог) и
// сам прогон pytest (иначе тест зависел бы от python3/pytest на машине этого
// теста). Дерево упражнения и его файлы читаются настоящими
// src/lib/exercise/tree.ts и file.ts на временном sourceDir — эта часть не
// мокается, потому что именно её и проверяет тест на дубль.
vi.mock("@/lib/config", () => ({
  loadConfig: () => ({ sourceDir, contentDir: "/unused", dataDir, python: "python3" }),
}));
vi.mock("@/lib/source/catalog", () => ({
  findLesson: () => duplicateRef,
}));
vi.mock("@/lib/content/step-file", () => ({
  readStep: () => ({
    id: "007-run",
    type: "code",
    title: "Т",
    exercise_fn: "run",
    body: "",
  }),
}));
vi.mock("@/lib/practice/run-tests", () => ({
  runTests: vi.fn(async () => ({
    total: 2,
    passed: 2,
    failed: 0,
    errors: 0,
    failures: [],
    filtered: false,
    warning: null,
    command: "python3 -m pytest -q",
    stdout: "",
  })),
}));

const { isPassingRun, POST } = await import("./route");
// Тот же мок, что видит route.ts (модуль ESM закэширован) — нужен, чтобы
// проверить не только итоговый ответ, но и то, с чем маршрут ЗВАЛ runTests:
// на фиксированном возврате мока тест на дубль иначе прошёл бы даже после
// регрессии, которая вернула бы фильтр по имени функции.
const { runTests } = await import("@/lib/practice/run-tests");
const runTestsMock = vi.mocked(runTests);

// Только валидация тела: она отвечает до loadConfig(), до чтения шага и до
// спавна интерпретатора. Успешный путь без дубля — приёмка руками (Task 21).
const params = { params: Promise.resolve({ slug: "test-slug" }) };

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/lesson/test-slug/tests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeDuplicateExercise(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-route-tests-"));
  const exerciseDir = path.join(dir, "learning-exercises", "p19-l20-loop");
  fs.mkdirSync(path.join(exerciseDir, "exercise.template"), { recursive: true });
  fs.writeFileSync(
    path.join(exerciseDir, "exercise.template", "main.py"),
    "def run(goal):\n    raise NotImplementedError\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(exerciseDir, "exercise.template", "hooks.py"),
    "def run(goal):\n    raise NotImplementedError\n",
    "utf8",
  );
  fs.writeFileSync(path.join(exerciseDir, "test_exercise.py"), "", "utf8");
  return dir;
}

describe("POST /api/lesson/[slug]/tests — валидация", () => {
  it("без stepId отвечает 400", async () => {
    const response = await POST(makeRequest({}), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("stepId");
  });

  it("на сломанный JSON отвечает 400, а не падает", async () => {
    const broken = new Request("http://localhost/api/lesson/test-slug/tests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{не json",
    });
    expect((await POST(broken, params)).status).toBe(400);
  });
});

describe("POST /api/lesson/[slug]/tests — многофайловое упражнение с дублем", () => {
  beforeEach(() => {
    sourceDir = makeDuplicateExercise();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-route-tests-data-"));
  });

  afterEach(() => {
    closeProgressDb(dataDir);
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
    runTestsMock.mockClear();
  });

  it("гоняет тесты без фильтра, когда имя функции шага есть в двух файлах", async () => {
    const response = await POST(makeRequest({ stepId: "007-run" }), params);
    const body = await response.json();

    expect(body.result.filtered).toBe(false);
    expect(body.result.warning).toBe(
      "Функция run есть в нескольких файлах упражнения — прогнан весь файл тестов",
    );
    // Главное, что доказывает тест: сам вызов runTests пошёл без фильтра.
    // filtered/warning в ответе — из фиксированного мока, а не из этого —
    // регрессия, вернувшая `fn: step.exercise_fn`, эти два поля бы не тронула.
    expect(runTestsMock).toHaveBeenCalledTimes(1);
    expect(runTestsMock.mock.calls[0][0]).toMatchObject({ fn: undefined });
  });
});

describe("isPassingRun", () => {
  it("все тесты прошли — зелёный", () => {
    expect(isPassingRun({ passed: 3, failed: 0, errors: 0 })).toBe(true);
  });

  it("часть тестов пропущена, но хотя бы один настоящий passed — зелёный", () => {
    expect(isPassingRun({ passed: 1, failed: 0, errors: 0 })).toBe(true);
  });

  it("все тесты пропущены, passed=0 — не зелёный: никто ничего не проверил", () => {
    expect(isPassingRun({ passed: 0, failed: 0, errors: 0 })).toBe(false);
  });

  it("есть падение — не зелёный", () => {
    expect(isPassingRun({ passed: 2, failed: 1, errors: 0 })).toBe(false);
  });
});
