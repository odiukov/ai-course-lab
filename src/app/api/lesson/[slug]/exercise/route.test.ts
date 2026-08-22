import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LessonRef } from "@/lib/source/catalog";

// Урок с каталожным (многофайловым) упражнением: main.py, events.py, hooks.py
// — та же фикстура, что в src/lib/exercise/tree.test.ts и file.test.ts,
// повторена намеренно (тестовые файлы не должны зависеть друг от друга).
const multiRef: LessonRef = {
  slug: "19-capstone-projects__20-loop",
  phaseDir: "19-capstone-projects",
  lessonDir: "20-loop",
  phaseNumber: 19,
  lessonNumber: 20,
  title: "Loop",
};

let sourceDir = "";

// GET/PUT читают конфиг и урок напрямую внутри route.ts (loadConfig() без
// параметров, findLesson по каталогу курса) — без подмены модулей тесту
// пришлось бы разворачивать настоящий курс на диске. Мокаются только эти два
// модуля: сама запись/чтение файла упражнения идёт через настоящие
// src/lib/exercise/file.ts на временном sourceDir, как и в проде.
vi.mock("@/lib/config", () => ({
  loadConfig: () => ({ sourceDir, python: "python3" }),
}));
vi.mock("@/lib/source/catalog", () => ({
  findLesson: () => multiRef,
}));

const { GET, PUT } = await import("./route");

const multiSlug = multiRef.slug;
const params = { params: Promise.resolve({ slug: multiSlug }) };

function makeMulti(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-route-exercise-"));
  const exerciseDir = path.join(dir, "learning-exercises", "p19-l20-loop");
  fs.mkdirSync(path.join(exerciseDir, "exercise.template"), { recursive: true });
  fs.writeFileSync(
    path.join(exerciseDir, "exercise.template", "main.py"),
    "def run(goal):\n    raise NotImplementedError\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(exerciseDir, "exercise.template", "events.py"),
    "def emit(event):\n    raise NotImplementedError\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(exerciseDir, "exercise.template", "hooks.py"),
    "def fire(topic):\n    raise NotImplementedError\n",
    "utf8",
  );
  fs.writeFileSync(path.join(exerciseDir, "test_exercise.py"), "", "utf8");
  return dir;
}

function makeRequest(body: string): Request {
  return new Request("http://localhost/api/lesson/test-slug/exercise", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
  });
}

beforeEach(() => {
  sourceDir = makeMulti();
});

afterEach(() => {
  fs.rmSync(sourceDir, { recursive: true, force: true });
});

describe("GET /api/lesson/[slug]/exercise — каталожная форма", () => {
  it("отдаёт список файлов упражнения", async () => {
    const response = await GET(new Request("http://localhost/api/lesson/x/exercise"), params);
    const body = await response.json();

    expect(body.multi).toBe(true);
    expect(body.files.map((file: { name: string }) => file.name)).toEqual([
      "main.py",
      "events.py",
      "hooks.py",
    ]);
  });
});

describe("PUT /api/lesson/[slug]/exercise — валидация", () => {
  it("без поля code отвечает 400", async () => {
    const response = await PUT(makeRequest(JSON.stringify({})), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("code");
  });

  it("на пустой код отвечает 400", async () => {
    const response = await PUT(makeRequest(JSON.stringify({ code: "  \n " })), params);
    expect(response.status).toBe(400);
  });

  it("на тело, которое не разбирается как JSON, отвечает 400, а не падает", async () => {
    const response = await PUT(makeRequest("{не json"), params);
    expect(response.status).toBe(400);
  });

  it("без поля file отвечает 400", async () => {
    const response = await PUT(
      makeRequest(JSON.stringify({ code: "x = 1\n", mtimeMs: 1 })),
      params,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Не передано поле file");
  });

  it("без mtimeMs отвечает 400: без него запись затирает чужую правку молча", async () => {
    const response = await PUT(
      makeRequest(JSON.stringify({ code: "x = 1\n", file: "exercise.py" })),
      params,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("mtimeMs");
  });
});

describe("PUT /api/lesson/[slug]/exercise — каталожная форма", () => {
  it("пишет в указанный файл", async () => {
    // Первое GET разворачивает все файлы шаблона на диск (как это делает
    // редактор при открытии урока) и отдаёт mtimeMs, который PUT потребует как
    // подтверждение, что файл на диске не поменялся с тех пор.
    const before = await GET(new Request("http://localhost/api/lesson/x/exercise"), params);
    const beforeFiles = (await before.json()).files as { name: string; mtimeMs: number }[];
    const eventsBefore = beforeFiles.find((file) => file.name === "events.py")!;
    const mainPath = path.join(
      sourceDir, "learning-exercises", "p19-l20-loop", "exercise", "main.py",
    );
    const mainBefore = fs.readFileSync(mainPath, "utf8");
    const mainMtimeBefore = fs.statSync(mainPath).mtimeMs;

    const response = await PUT(
      makeRequest(
        JSON.stringify({
          file: "events.py",
          code: "def emit(event):\n    return event\n",
          mtimeMs: eventsBefore.mtimeMs,
        }),
      ),
      params,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("events.py");
    expect(
      fs.readFileSync(
        path.join(sourceDir, "learning-exercises", "p19-l20-loop", "exercise", "events.py"),
        "utf8",
      ),
    ).toBe("def emit(event):\n    return event\n");
    // Соседний файл, где имя совпадает по позиции в шаблоне, но не по адресу
    // запроса, не тронут: и содержимым, и mtime.
    expect(fs.readFileSync(mainPath, "utf8")).toBe(mainBefore);
    expect(fs.statSync(mainPath).mtimeMs).toBe(mainMtimeBefore);
  });

  it("в файл вне шаблона отвечает 400", async () => {
    const response = await PUT(
      makeRequest(JSON.stringify({ file: "nope.py", code: "x = 1\n", mtimeMs: 1 })),
      params,
    );
    expect(response.status).toBe(400);
  });
});
