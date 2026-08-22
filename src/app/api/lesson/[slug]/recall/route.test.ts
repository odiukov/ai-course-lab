import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LessonRef } from "@/lib/source/catalog";

// Текущий урок — каталожное упражнение, где run объявлен и в main.py, и в
// hooks.py. Дубль — не украшение фикстуры: он единственный способ доказать,
// что POST вставляет прошлый код ИМЕННО в переданный file, а не угадывает
// его сам. Угадывание (resolveExerciseFile без объявленного файла) в этой
// фикстуре указало бы на main.py — первый файл шаблона, — и тест это
// отличил бы от правильного hooks.py.
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
// Частичный мок: readWrittenFunctions (внутри findPreviousImplementation)
// сам читает readCatalog из этого модуля, и его нужно оставить настоящим —
// подменяется только findLesson, за которым приходит маршрут.
vi.mock("@/lib/source/catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/source/catalog")>()),
  findLesson: () => duplicateRef,
}));

const { GET, POST } = await import("./route");

// Как и в остальных route-тестах проекта, часть проверок — только валидация:
// она отвечает до loadConfig() и до любого чтения/записи на диск. Путь с
// найденным/не найденным упражнением покрыт тестами
// src/lib/exercise/recall.test.ts и приёмкой руками, адресация по file —
// тестом ниже.
const params = { params: Promise.resolve({ slug: "test-slug" }) };

function getRequest(query: string): Request {
  return new Request(`http://localhost/api/lesson/test-slug/recall${query}`);
}

function postRequest(body: string): Request {
  return new Request("http://localhost/api/lesson/test-slug/recall", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

// Урок с историей (`p05-l02-old-run`, одно-файловая форма, run уже написана)
// и текущий каталожный урок с дублем run в main.py/hooks.py.
function makeCourseWithHistory(): string {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-route-recall-"));

  const oldDir = path.join(sourceDir, "learning-exercises", "p05-l02-old-run");
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(
    path.join(oldDir, "exercise.template.py"),
    "def run(goal):\n    raise NotImplementedError\n",
    "utf8",
  );
  fs.writeFileSync(path.join(oldDir, "exercise.py"), "def run(goal):\n    return 42\n", "utf8");

  const currentDir = path.join(sourceDir, "learning-exercises", "p19-l20-loop");
  const template = path.join(currentDir, "exercise.template");
  fs.mkdirSync(template, { recursive: true });
  const stub = "def run(goal):\n    raise NotImplementedError\n";
  fs.writeFileSync(path.join(template, "main.py"), stub, "utf8");
  fs.writeFileSync(path.join(template, "hooks.py"), stub, "utf8");
  fs.writeFileSync(path.join(currentDir, "test_exercise.py"), "", "utf8");

  return sourceDir;
}

describe("GET /api/lesson/[slug]/recall — валидация", () => {
  it("без ?fn отвечает 400", async () => {
    const response = await GET(getRequest(""), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("функция");
  });

  it("на пустой ?fn=  отвечает 400", async () => {
    const response = await GET(getRequest("?fn=%20%20"), params);
    expect(response.status).toBe(400);
  });
});

describe("POST /api/lesson/[slug]/recall — валидация", () => {
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

describe("POST /api/lesson/[slug]/recall — каталожная форма", () => {
  beforeEach(() => {
    sourceDir = makeCourseWithHistory();
  });

  afterEach(() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  it("вставляет прошлую реализацию в указанный файл, а не в первый по шаблону", async () => {
    const response = await POST(
      postRequest(JSON.stringify({ fn: "run", file: "hooks.py" })),
      params,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.code).toContain("return 42");

    const exerciseDir = path.join(sourceDir, "learning-exercises", "p19-l20-loop", "exercise");
    expect(fs.readFileSync(path.join(exerciseDir, "hooks.py"), "utf8")).toContain("return 42");
    // main.py — тоже run, но не адресован этим запросом — заготовка не тронута.
    expect(fs.readFileSync(path.join(exerciseDir, "main.py"), "utf8")).toContain(
      "raise NotImplementedError",
    );
  });
});
