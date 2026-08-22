import { describe, expect, it } from "vitest";
import type { ExerciseFileSet, ExerciseFileState } from "@/lib/exercise/file";
import type { ExerciseTree } from "@/lib/exercise/tree";
import { POST, resolveReviewTargets } from "./route";

// Только валидация тела: отвечает до loadConfig(), до замера и до агента.
const params = { params: Promise.resolve({ slug: "test-slug" }) };

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/lesson/test-slug/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/lesson/[slug]/review — валидация", () => {
  it("без stepId отвечает 400", async () => {
    const response = await POST(makeRequest({}), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("stepId");
  });

  it("на сломанный JSON отвечает 400", async () => {
    const broken = new Request("http://localhost/api/lesson/test-slug/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{не json",
    });
    expect((await POST(broken, params)).status).toBe(400);
  });
});

// resolveReviewTargets вынесена из POST ровно из-за этой проверки: поднять
// весь маршрут в тесте дорого (SSE, агент, реальный прогон бенчмарка), а выбор
// файла человека и пути эталона — чистая функция без них. Именно этот выбор
// раньше был жёстко вписанным "exercise.py" и склейкой `<dir>/solution.py` —
// оба неверны для каталожной формы, и маршрут 404-ился до runBench.
function makeFileState(name: string, code = ""): ExerciseFileState {
  return {
    name,
    file: `/src/learning-exercises/p19-l20-loop/exercise/${name}`,
    relPath: `learning-exercises/p19-l20-loop/exercise/${name}`,
    code,
    mtimeMs: 0,
    functions: [],
    createdFromTemplate: false,
  };
}

function makeSet(names: string[]): ExerciseFileSet {
  return {
    exerciseSlug: "p19-l20-loop",
    dir: "/src/learning-exercises/p19-l20-loop",
    multi: names.length > 1,
    files: names.map((name) => makeFileState(name)),
  };
}

function makeTree(multi: boolean, files: { name: string; solutionPath: string | null }[]): ExerciseTree {
  return {
    slug: "p19-l20-loop",
    dir: "/src/learning-exercises/p19-l20-loop",
    multi,
    files: files.map((item) => ({
      name: item.name,
      templatePath: `/src/learning-exercises/p19-l20-loop/exercise.template/${item.name}`,
      workPath: `/src/learning-exercises/p19-l20-loop/exercise/${item.name}`,
      solutionPath: item.solutionPath,
    })),
    testPath: null,
    duplicateFunctions: [],
  };
}

describe("resolveReviewTargets", () => {
  it("каталожная форма: находит файл человека по объявленному имени, а не по литералу exercise.py", () => {
    const tree = makeTree(true, [
      { name: "main.py", solutionPath: "/solution/main.py" },
      { name: "hooks.py", solutionPath: "/solution/hooks.py" },
    ]);
    const set = makeSet(["main.py", "hooks.py"]);

    const targets = resolveReviewTargets(tree, set, "fire", "hooks.py");

    expect(targets?.exercise.name).toBe("hooks.py");
    expect(targets?.solutionPath).toBe("/solution/hooks.py");
  });

  it("здесь маршрут раньше уходил в 404: старый литерал exercise.py не нашёл бы hooks.py вовсе", () => {
    const tree = makeTree(true, [{ name: "hooks.py", solutionPath: "/solution/hooks.py" }]);
    const set = makeSet(["hooks.py"]);

    // Старая реализация искала set.files.find(item => item.name === "exercise.py")
    // — на этой фикстуре получила бы undefined и 404 до runBench.
    expect(set.files.find((item) => item.name === "exercise.py")).toBeUndefined();
    // Новая ищет по тому же имени, что resolveExerciseFile отдаёт тестам и замеру.
    expect(resolveReviewTargets(tree, set, "fire", "hooks.py")?.exercise.name).toBe("hooks.py");
  });

  it("одно-файловая форма не меняется: имя exercise.py и путь эталона как раньше", () => {
    const tree = makeTree(false, [{ name: "exercise.py", solutionPath: "/solution.py" }]);
    const set = makeSet(["exercise.py"]);

    const targets = resolveReviewTargets(tree, set, "transpose", undefined);

    expect(targets?.exercise.name).toBe("exercise.py");
    expect(targets?.solutionPath).toBe("/solution.py");
  });

  it("эталона нет — solutionPath null, а не путь к несуществующему файлу", () => {
    const tree = makeTree(false, [{ name: "exercise.py", solutionPath: null }]);
    const set = makeSet(["exercise.py"]);

    expect(resolveReviewTargets(tree, set, "transpose", undefined)?.solutionPath).toBeNull();
  });

  it("объявленный файл вне упражнения — null: маршрут отвечает 404, как и на настоящее отсутствие", () => {
    const tree = makeTree(true, [{ name: "main.py", solutionPath: null }]);
    const set = makeSet(["main.py"]);

    expect(resolveReviewTargets(tree, set, "fire", "hooks.py")).toBeNull();
  });
});
