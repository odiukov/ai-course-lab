import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LessonRef } from "@/lib/source/catalog";

// Урок с каталожным упражнением, где run объявлен и в main.py, и в hooks.py.
// Дубль — не украшение фикстуры: он единственный способ доказать, что POST
// пишет ИМЕННО в переданный file, а не угадывает его сам. Угадывание
// (resolveExerciseFile без объявленного файла) в этой фикстуре указало бы на
// main.py — первый файл шаблона, — и тест это отличил бы от правильного
// hooks.py.
const duplicateRef: LessonRef = {
  slug: "19-capstone-projects__20-loop",
  phaseDir: "19-capstone-projects",
  lessonDir: "20-loop",
  phaseNumber: 19,
  lessonNumber: 20,
  title: "Loop",
};

let sourceDir = "";

vi.mock("@/lib/config", () => ({
  loadConfig: () => ({ sourceDir }),
}));
vi.mock("@/lib/source/catalog", () => ({
  findLesson: () => duplicateRef,
}));

const { POST } = await import("./route");

// Как и в остальных route-тестах проекта, часть проверок — только валидация
// тела: она отвечает до loadConfig() и до любого чтения/записи на диск. Сам
// сброс покрыт src/lib/exercise/reset.test.ts, а адресация по file — тестом
// ниже.
const params = { params: Promise.resolve({ slug: "test-slug" }) };

function postRequest(body: string): Request {
  return new Request("http://localhost/api/lesson/test-slug/exercise/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function makeDuplicateExercise(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-route-reset-"));
  const exerciseDir = path.join(dir, "learning-exercises", "p19-l20-loop");
  const template = path.join(exerciseDir, "exercise.template");
  const work = path.join(exerciseDir, "exercise");
  fs.mkdirSync(template, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const stub = "def run(goal):\n    raise NotImplementedError\n";
  fs.writeFileSync(path.join(template, "main.py"), stub, "utf8");
  fs.writeFileSync(path.join(template, "hooks.py"), stub, "utf8");
  // Обе рабочие копии уже "написаны" по-разному — чтобы после сброса можно
  // было отличить нетронутый файл от сброшенного по содержимому.
  fs.writeFileSync(path.join(work, "main.py"), "def run(goal):\n    return 111\n", "utf8");
  fs.writeFileSync(path.join(work, "hooks.py"), "def run(goal):\n    return 999\n", "utf8");
  fs.writeFileSync(path.join(exerciseDir, "test_exercise.py"), "", "utf8");
  return dir;
}

describe("POST /api/lesson/[slug]/exercise/reset — валидация", () => {
  it("без поля fn отвечает 400", async () => {
    const response = await POST(postRequest(JSON.stringify({})), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("функция");
  });

  it("на пустой fn отвечает 400", async () => {
    const response = await POST(postRequest(JSON.stringify({ fn: "  " })), params);
    expect(response.status).toBe(400);
  });

  it("на тело, которое не разбирается как JSON, отвечает 400, а не падает", async () => {
    const response = await POST(postRequest("{не json"), params);
    expect(response.status).toBe(400);
  });
});

describe("POST /api/lesson/[slug]/exercise/reset — каталожная форма", () => {
  beforeEach(() => {
    sourceDir = makeDuplicateExercise();
  });

  afterEach(() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  it("сбрасывает функцию в указанном файле, а не в первом по шаблону", async () => {
    const response = await POST(
      postRequest(JSON.stringify({ fn: "run", file: "hooks.py" })),
      params,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("hooks.py");

    const exerciseDir = path.join(sourceDir, "learning-exercises", "p19-l20-loop", "exercise");
    expect(fs.readFileSync(path.join(exerciseDir, "hooks.py"), "utf8")).toContain(
      "raise NotImplementedError",
    );
    // main.py — тоже "run", но не адресован этим запросом — остаётся как был.
    expect(fs.readFileSync(path.join(exerciseDir, "main.py"), "utf8")).toBe(
      "def run(goal):\n    return 111\n",
    );
  });
});
