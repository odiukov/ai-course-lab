import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExerciseFileSet, ExerciseFileState } from "@/lib/exercise/file";
import type { ExerciseTree } from "@/lib/exercise/tree";
import type { LessonRef } from "@/lib/source/catalog";

const ref: LessonRef = {
  slug: "19-capstone-projects__20-loop",
  phaseDir: "19-capstone-projects",
  lessonDir: "20-loop",
  phaseNumber: 19,
  lessonNumber: 20,
  title: "Loop",
};

let sourceDir = "";
// Шаг, который вернёт мок readStep: у каждого теста он свой (свой файл и своя
// функция), поэтому мок читает переменную, а не замыкает значение.
let currentStep: { id: string; exercise_fn: string; exercise_file?: string } = {
  id: "007-run",
  exercise_fn: "run",
};

// Мокается всё, что уводит маршрут за пределы проверяемого: конфиг и урок
// (иначе тесту нужен настоящий курс), план и шаг (иначе — контент-каталог),
// запись прогона, агент, чат и база (иначе — sqlite и настоящая модель) и сам
// замер (иначе — python3 и две минуты повторов). Дерево упражнения и файлы
// человека читаются НАСТОЯЩИМИ tree.ts и file.ts на временном sourceDir:
// именно они решают, есть ли у файла эталон, и именно это здесь и проверяется.
vi.mock("@/lib/config", () => ({
  loadConfig: () => ({
    sourceDir,
    contentDir: "/unused",
    dataDir: "/unused",
    python: "python3",
    agent: "claude",
  }),
}));
vi.mock("@/lib/source/catalog", () => ({ findLesson: () => ref }));
vi.mock("@/lib/content/lesson-plan", () => ({
  readLessonPlan: () => ({ title: "Loop", slug: ref.slug, steps: [] }),
}));
// Частично: из этого же модуля берут схемы соседи (write-step.ts, который
// тянет за собой review-code.ts), и полная подмена оставила бы их без экспорта.
vi.mock("@/lib/content/step-file", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/content/step-file")>()),
  readStep: () => ({ type: "code", title: "Т", body: "", ...currentStep }),
}));
vi.mock("@/lib/progress/tests", () => ({
  lastTestRun: () => ({ passed: 2, failed: 0, filtered: true, warning: null }),
}));
vi.mock("@/lib/progress/db", () => ({ openProgressDb: () => ({}) }));
vi.mock("@/lib/progress/settings", () => ({ readAgent: () => "claude" }));
vi.mock("@/lib/progress/chat", () => ({
  openChatSession: () => 1,
  addChatMessage: () => 1,
}));
vi.mock("@/lib/agent/factory", () => ({ defaultDeps: () => ({}) }));
vi.mock("@/lib/practice/bench", () => ({
  runBench: vi.fn(async () => ({
    exercise: "p19-l20-loop",
    functions: [
      {
        fn: "run",
        written: true,
        mine: { lines: 3, loops: 1, depth: 1, branches: 0, us: 12 },
        ref: { lines: 2, loops: 1, depth: 1, branches: 0, us: 11 },
        ratio: 1.09,
        status: "ok",
      },
    ],
    ruff: { available: true, findings: [] },
  })),
}));
// Форматтеры — настоящие: тест проверяет, ЧТО именно уходит в промпт, и
// подделка формата проверяла бы саму себя. Мокается только вызов модели.
vi.mock("@/lib/generate/review-code", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/generate/review-code")>()),
  reviewCode: vi.fn(async () => "разбор"),
}));

// Маршрут импортируется динамически, а не статически: фабрики vi.mock выше
// читают переменные этого файла (sourceDir, ref, currentStep), а статический
// импорт исполнил бы их до инициализации этих переменных.
const { POST, resolveReviewTargets } = await import("./route");
const { runBench } = await import("@/lib/practice/bench");
const runBenchMock = vi.mocked(runBench);
const { reviewCode } = await import("@/lib/generate/review-code");
const reviewCodeMock = vi.mocked(reviewCode);

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

/**
 * Каталожное упражнение, где эталон есть только у main.py: helpers.py — тот
 * самый вспомогательный файл, которому tree.ts законно отдаёт
 * solutionPath: null (спека это разрешает, и маршрут для кода эталона уже
 * деградирует до «(эталона нет)»).
 */
function makeExerciseWithoutSolution(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-route-review-"));
  const exercise = path.join(dir, "learning-exercises", "p19-l20-loop");
  fs.mkdirSync(path.join(exercise, "exercise.template"), { recursive: true });
  fs.mkdirSync(path.join(exercise, "solution"), { recursive: true });
  fs.writeFileSync(
    path.join(exercise, "exercise.template", "main.py"),
    "def run(goal):\n    return goal\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(exercise, "exercise.template", "helpers.py"),
    "def shape(matrix):\n    return len(matrix)\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(exercise, "solution", "main.py"),
    "def run(goal):\n    return goal\n",
    "utf8",
  );
  fs.writeFileSync(path.join(exercise, "test_exercise.py"), "", "utf8");
  return dir;
}

// Здесь маршрут раньше умирал целиком: bench.py требует solution/<файл> и на
// его отсутствии выходит с кодом 2, runBench превращал это в исключение, и
// шаг про вспомогательный файл не доходил даже до сборки промпта.
describe("POST /api/lesson/[slug]/review — файл без эталона", () => {
  beforeEach(() => {
    sourceDir = makeExerciseWithoutSolution();
  });

  afterEach(() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    runBenchMock.mockClear();
    reviewCodeMock.mockClear();
  });

  async function events(body: unknown): Promise<string> {
    const response = await POST(makeRequest(body), params);
    expect(response.status).toBe(200);
    return await response.text();
  }

  it("не зовёт замер и доводит разбор до конца", async () => {
    currentStep = { id: "008-shape", exercise_fn: "shape", exercise_file: "helpers.py" };

    const stream = await events({ stepId: "008-shape" });

    expect(runBenchMock).not.toHaveBeenCalled();
    expect(stream).not.toContain("event: bench");
    expect(stream).toContain("event: done");
    expect(stream).not.toContain("event: error");
  });

  it("говорит агенту «эталона нет», а не «замер не удался»", async () => {
    currentStep = { id: "008-shape", exercise_fn: "shape", exercise_file: "helpers.py" };

    await events({ stepId: "008-shape" });

    expect(reviewCodeMock).toHaveBeenCalledTimes(1);
    const sent = reviewCodeMock.mock.calls[0][0].request;
    expect(sent.solutionCode).toBe("(эталона нет)");
    expect(sent.metrics).toBe("(эталона нет — сравнивать не с чем)");
    expect(sent.mineCode).toContain("def shape(matrix)");
  });

  it("файл с эталоном по-прежнему замеряется — и именно своим модулем", async () => {
    currentStep = { id: "007-run", exercise_fn: "run", exercise_file: "main.py" };

    await events({ stepId: "007-run" });

    expect(runBenchMock).toHaveBeenCalledTimes(1);
    expect(runBenchMock.mock.calls[0][0]).toMatchObject({ fn: "run", module: "main.py" });
    expect(reviewCodeMock.mock.calls[0][0].request.metrics).toContain("строк: 3 / 2");
  });

  it("квалифицированный метод разбирается по эталону, но не запускает фиктивный runtime-бенч", async () => {
    const exercise = path.join(sourceDir, "learning-exercises", "p19-l20-loop");
    const code = [
      "class HarnessLoop:",
      "    def _transition(self, target):",
      "        self.state = target",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(exercise, "exercise.template", "main.py"), code, "utf8");
    fs.writeFileSync(path.join(exercise, "solution", "main.py"), code, "utf8");
    fs.writeFileSync(
      path.join(exercise, "exercise.json"),
      JSON.stringify({
        version: 1,
        targets: [
          {
            file: "main.py",
            symbol: "HarnessLoop._transition",
            tests: ["test_exercise.py"],
          },
        ],
      }),
      "utf8",
    );
    currentStep = {
      id: "007-transition",
      exercise_fn: "HarnessLoop._transition",
      exercise_file: "main.py",
    };

    await events({ stepId: "007-transition" });

    expect(runBenchMock).not.toHaveBeenCalled();
    const sent = reviewCodeMock.mock.calls[0][0].request;
    expect(sent.mineCode).toContain("def _transition");
    expect(sent.solutionCode).toContain("self.state = target");
    expect(sent.metrics).toBe("(runtime-замер для метода не предусмотрен)");
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
    testPaths: [],
    targets: null,
    run: null,
    requirements: [],
    network: false,
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
