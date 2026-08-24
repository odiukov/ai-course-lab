import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  describeFunctions,
  readCanonicalFunctionNames,
  readExerciseCodeBySlug,
} from "@/lib/exercise/file";
import { canonicalFunctions, readExerciseTree } from "@/lib/exercise/tree";
import type { LessonRef } from "@/lib/source/catalog";
import { PracticeError } from "./errors";
import { buildTestFilter, runTests, selectDirectTestNames } from "./run-tests";

const FAKE = path.join(process.cwd(), "tests/fixtures/practice/fake-python.mjs");

// Функции настоящего упражнения урока 02 в том порядке, в котором их отдаёт
// describeFunctions, — и порядок шагов, в котором учащийся их пишет.
const LESSON02 = ["transpose", "matmul", "identity", "trace", "is_symmetric", "hadamard"];
const LESSON01 = [
  "magnitude",
  "dot",
  "cosine_similarity",
  "angle_between",
  "project",
  "matvec",
  "is_invertible_2x2",
  "most_similar_pair",
];

const LESSON02_REF: LessonRef = {
  slug: "01-math__02-matrices",
  phaseDir: "01-math",
  lessonDir: "02-matrices",
  phaseNumber: 1,
  lessonNumber: 2,
  title: "Матрицы",
};

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-tests-"));
  fs.writeFileSync(path.join(dir, "test_exercise.py"), "# заглушка\n", "utf8");
  return dir;
}

// Гоняет подделку интерпретатора на настоящих именах тестов урока 02 и
// отдаёт имена, которые выражение -k отобрало на ПЕРВОМ прогоне (второй, если
// он был, — это уже откат на весь файл).
async function selection(fn: string, functions: string[] = LESSON02, testNames?: string[]) {
  process.env.FAKE_PYTHON_MODE = testNames ? "selection" : "lesson02";
  if (testNames) process.env.FAKE_PYTHON_TEST_NAMES = JSON.stringify(testNames);
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lab-select-")), "selected.txt");
  process.env.FAKE_PYTHON_SELECTED = log;
  const result = await runTests({ dir: makeDir(), fn, functions, python: FAKE });
  // Одна строка на прогон, каждая заканчивается \n — поэтому последний,
  // пустой, элемент split отбрасывается, а строка пустого отбора остаётся.
  const runs = fs
    .readFileSync(log, "utf8")
    .split("\n")
    .slice(0, -1)
    .map((line) => line.split(",").filter((name) => name.length > 0));
  return { result, first: runs[0] ?? [], runs };
}

afterEach(() => {
  delete process.env.FAKE_PYTHON_MODE;
  delete process.env.FAKE_PYTHON_SELECTED;
  delete process.env.FAKE_PYTHON_TEST_NAMES;
});

describe("buildTestFilter", () => {
  it("без соседних функций фильтр — просто имя", () => {
    expect(buildTestFilter("transpose", ["transpose"])).toBe("transpose");
    expect(buildTestFilter("transpose")).toBe("transpose");
  });

  it("отрицает все остальные функции упражнения", () => {
    expect(buildTestFilter("hadamard", LESSON02)).toBe(
      "hadamard and not (transpose or matmul or identity or trace or is_symmetric)",
    );
  });

  it("не отрицает имя, которое само является подстрокой нужного", () => {
    // Иначе `matmul` в отрицании обнулил бы отбор для `matmul_fast` целиком.
    expect(buildTestFilter("matmul_fast", ["matmul", "matmul_fast"])).toBe("matmul_fast");
  });
});

describe("selectDirectTestNames", () => {
  it("находит тесты по реальному вызову, даже когда имя теста сокращено", () => {
    const source = `def test_loss_is_zero():
    assert flow_matching_loss(lambda x: x, [], [], []) == 0

def test_other():
    assert interpolate(0, 1, 0.5) == 0.5
`;

    expect(
      selectDirectTestNames(source, "flow_matching_loss", ["interpolate", "flow_matching_loss"]),
    ).toEqual(["test_loss_is_zero"]);
  });

  it("не выбирает интеграционный тест, которому нужна другая функция упражнения", () => {
    const source = `def test_identity_is_symmetric():
    assert is_symmetric(identity(4))

def test_symmetric_true():
    assert is_symmetric([[1]])
`;

    expect(selectDirectTestNames(source, "is_symmetric", ["identity", "is_symmetric"])).toEqual([
      "test_symmetric_true",
    ]);
  });

  it("проходит через локальный helper с предметным именем", () => {
    const source = `def message():
    return make_message("m-1", {})

def test_message_has_an_id():
    assert message()["id"] == "m-1"
`;

    expect(selectDirectTestNames(source, "make_message", ["make_message", "make_task"])).toEqual([
      "test_message_has_an_id",
    ]);
  });

  it("берёт интеграционные тесты, если изолированных для функции нет", () => {
    const source = `def test_composition():
    assert outer(inner(1)) == 2
`;

    expect(selectDirectTestNames(source, "outer", ["inner", "outer"])).toEqual([
      "test_composition",
    ]);
  });
});

describe("контракт code-шагов всего курса", () => {
  const root = process.cwd();
  const sourceDir = path.join(root, "source");
  const lessonRoot = path.join(root, "content/lessons");
  const lessonDirs = fs.readdirSync(lessonRoot).filter((name) => /^\d+-.*__\d+-/.test(name));

  it("каждый exercise_fn существует в шаблоне упражнения", () => {
    const missing: string[] = [];
    for (const lessonDir of lessonDirs) {
      const match = /^(\d+)-.*__(\d+)-/.exec(lessonDir)!;
      const plan = JSON.parse(
        fs.readFileSync(path.join(lessonRoot, lessonDir, "lesson.json"), "utf8"),
      ) as { steps?: { exercise_fn?: string }[] };
      const fns = [...new Set((plan.steps ?? []).map((step) => step.exercise_fn).filter(Boolean))] as string[];
      if (fns.length === 0) continue;

      const ref = {
        slug: lessonDir,
        phaseNumber: Number(match[1]),
        lessonNumber: Number(match[2]),
      } as LessonRef;
      const tree = readExerciseTree(sourceDir, ref);
      const available = new Set(tree ? canonicalFunctions(tree).map((item) => item.fn) : []);
      for (const fn of fns) {
        if (!available.has(fn)) missing.push(`${lessonDir}: ${fn}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("для каждого exercise_fn раннер может выбрать собственные тесты", () => {
    const missing: string[] = [];
    for (const lessonDir of lessonDirs) {
      const match = /^(\d+)-.*__(\d+)-/.exec(lessonDir)!;
      const plan = JSON.parse(
        fs.readFileSync(path.join(lessonRoot, lessonDir, "lesson.json"), "utf8"),
      ) as { steps?: { exercise_fn?: string }[] };
      const fns = [...new Set((plan.steps ?? []).map((step) => step.exercise_fn).filter(Boolean))] as string[];
      if (fns.length === 0) continue;

      const ref = {
        slug: lessonDir,
        phaseNumber: Number(match[1]),
        lessonNumber: Number(match[2]),
      } as LessonRef;
      const tree = readExerciseTree(sourceDir, ref);
      // Серия 76–81 проверяет все швы одним итоговым `python main.py`:
      // требовать здесь отдельный pytest означало бы вернуть именно ложный
      // пошаговый зачёт, ради отказа от которого у дерева есть run-контракт.
      if (tree?.run) continue;
      if (tree?.targets) {
        for (const fn of fns) {
          if (!tree.targets.some((target) => target.fn === fn && target.tests.length > 0)) {
            missing.push(`${lessonDir}: ${fn}`);
          }
        }
        continue;
      }
      if (!tree?.testPath) {
        missing.push(`${lessonDir}: нет test_exercise.py`);
        continue;
      }
      const functions = canonicalFunctions(tree).map((item) => item.fn);
      const tests = fs.readFileSync(tree.testPath, "utf8");
      const testNames = [...tests.matchAll(/^def\s+(test_[A-Za-z0-9_]+)\s*\(/gm)].map(
        (item) => item[1],
      );

      for (const fn of fns) {
        const direct = selectDirectTestNames(tests, fn, functions);
        const others = functions.filter((name) => name !== fn && !fn.includes(name));
        const named = testNames.filter(
          (name) => name.includes(fn) && !others.some((other) => name.includes(other)),
        );
        if (direct.length === 0 && named.length === 0) missing.push(`${lessonDir}: ${fn}`);
      }
    }
    expect(missing).toEqual([]);
  }, 15_000);
});

describe("runTests: отбор на настоящих именах тестов урока 02", () => {
  it("hadamard не тянет за собой тест, который зовёт ещё не написанный matmul", async () => {
    const { result, first } = await selection("hadamard");
    expect(first).toEqual([
      "test_hadamard_scales_elementwise",
      "test_hadamard_with_zero_mask_zeroes_everything",
    ]);
    expect(first).not.toContain("test_hadamard_differs_from_matmul");
    expect(result).toMatchObject({ total: 2, passed: 2, filtered: true, warning: null });
  });

  it("identity не тянет тесты matmul, trace и симметрии", async () => {
    const { result, first } = await selection("identity");
    expect(first).toEqual(["test_identity_shape_and_content", "test_identity_of_one"]);
    expect(result).toMatchObject({ total: 2, filtered: true, warning: null });
  });

  it("is_symmetric запускает только два собственных теста", async () => {
    const { result, first, runs } = await selection("is_symmetric");
    expect(first).toEqual(["test_is_symmetric_true", "test_is_symmetric_false"]);
    expect(runs).toHaveLength(1);
    expect(result).toMatchObject({ total: 2, passed: 2, filtered: true, warning: null });
  });

  it("transpose отбирает все три своих теста", async () => {
    const { first } = await selection("transpose");
    expect(first).toEqual([
      "test_transpose_rectangular",
      "test_transpose_twice_returns_original",
      "test_transpose_returns_lists_not_tuples",
    ]);
  });

  it("matmul не гоняет тест, которому нужна ещё не написанная identity", async () => {
    const { first } = await selection("matmul");
    expect(first).toEqual([
      "test_matmul_row_by_column",
      "test_matmul_shapes_2x3_by_3x2",
      "test_matmul_is_not_commutative",
    ]);
  });
});

describe("runTests: каждый code-шаг урока 01 имеет собственные тесты", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "source/learning-exercises/p01-l01-linear-algebra-intuition/test_exercise.py",
    ),
    "utf8",
  );
  const testNames = [...source.matchAll(/^def (test_[a-zA-Z0-9_]+)\(/gm)].map((match) => match[1]);
  const expectedCounts: Record<string, number> = {
    magnitude: 4,
    dot: 4,
    cosine_similarity: 4,
    angle_between: 4,
    project: 4,
    matvec: 5,
    is_invertible_2x2: 4,
    most_similar_pair: 3,
  };

  it.each(LESSON01)("%s не откатывается к прогону всего упражнения", async (fn) => {
    const { result, first, runs } = await selection(fn, LESSON01, testNames);

    expect(first).toHaveLength(expectedCounts[fn]);
    expect(runs).toHaveLength(1);
    expect(result).toMatchObject({
      total: expectedCounts[fn],
      filtered: true,
      warning: null,
    });
  });
});

// Откуда берётся список «остальных функций» — не деталь реализации, а разница
// между честным прогоном и ложным зелёным. Список собирается из шаблона
// упражнения (readCanonicalFunctionNames), потому что учащийся в свой exercise.py
// дописывает вспомогательные функции, и они не должны попадать в отрицание -k.
describe("состав упражнения для фильтра берётся из шаблона, а не из файла учащегося", () => {
  function makeLesson02Source(): string {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-canon-"));
    const dir = path.join(sourceDir, "learning-exercises", "p01-l02-matrices");
    fs.mkdirSync(dir, { recursive: true });
    const template = LESSON02.map((fn) => `def ${fn}(M):\n    raise NotImplementedError\n`).join("\n\n");
    fs.writeFileSync(path.join(dir, "exercise.template.py"), `${template}\n`, "utf8");
    // Так выглядит файл учащегося на шаге identity: три функции написаны, и
    // рядом лежит его собственная вспомогательная `shape`.
    const solved = `${LESSON02.map((fn) => `def ${fn}(M):\n    return shape(M)\n`).join("\n\n")}\n\ndef shape(M):\n    return len(M), len(M[0])\n`;
    fs.writeFileSync(path.join(dir, "exercise.py"), solved, "utf8");
    return sourceDir;
  }

  it("вспомогательная `shape` учащегося не отрезает test_identity_shape_and_content", async () => {
    const sourceDir = makeLesson02Source();
    const canonical = readCanonicalFunctionNames(sourceDir, LESSON02_REF);
    expect(canonical).toEqual(LESSON02);

    const { result, first } = await selection("identity", canonical);
    expect(first).toEqual(["test_identity_shape_and_content", "test_identity_of_one"]);
    expect(result).toMatchObject({ total: 2, passed: 2, filtered: true, warning: null });
  });

  it("состав из живого файла дал бы ложное «1 из 1 зелёные»", async () => {
    const sourceDir = makeLesson02Source();
    const live = describeFunctions(readExerciseCodeBySlug(sourceDir, "p01-l02-matrices")!).map(
      (item) => item.fn,
    );
    expect(live).toContain("shape");

    const { result, first } = await selection("identity", live);
    // Ровно тот дефект: настоящий тест шага отрезан отрицанием `shape`, а
    // прогон при этом выглядит зелёным и отфильтрованным, без предупреждения.
    expect(first).not.toContain("test_identity_shape_and_content");
    expect(result).toMatchObject({ total: 1, passed: 1, filtered: true, warning: null });
  });
});

describe("runTests", () => {
  it("зелёный прогон: считает пройденные и не выдумывает предупреждений", async () => {
    const result = await runTests({ dir: makeDir(), fn: "transpose", python: FAKE });
    expect(result).toMatchObject({ total: 2, passed: 2, failed: 0, filtered: true, warning: null });
    expect(result.command).toContain('-k "transpose"');
  });

  it("красный прогон: отдаёт первый упавший с решающей строкой", async () => {
    process.env.FAKE_PYTHON_MODE = "red";
    const result = await runTests({ dir: makeDir(), fn: "transpose", python: FAKE });
    expect(result.failed).toBe(1);
    expect(result.failures[0].name).toBe("test_transpose_twice_returns_original");
    expect(result.failures[0].decisive).toContain("assert 0 == 32");
  });

  it("если -k не дал тестов, гоняет весь файл и предупреждает", async () => {
    process.env.FAKE_PYTHON_MODE = "empty-filter";
    const result = await runTests({ dir: makeDir(), fn: "nosuch", python: FAKE });
    expect(result.total).toBe(2);
    expect(result.filtered).toBe(false);
    expect(result.warning).toContain("nosuch");
  });

  it("интерпретатор без pytest — это PracticeError, а не пустой прогон", async () => {
    process.env.FAKE_PYTHON_MODE = "missing-pytest";
    await expect(runTests({ dir: makeDir(), python: FAKE })).rejects.toMatchObject({
      name: "PracticeError",
      kind: "python",
    });
  });

  it("несуществующий интерпретатор даёт kind spawn", async () => {
    await expect(
      runTests({ dir: makeDir(), python: path.join(os.tmpdir(), "no-such-python") }),
    ).rejects.toMatchObject({ kind: "spawn" });
  });

  it("зависший прогон убивается по таймауту", async () => {
    process.env.FAKE_PYTHON_MODE = "hang";
    await expect(
      runTests({ dir: makeDir(), python: FAKE, timeoutMs: 300 }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("PracticeError несёт человеческое сообщение по-русски", async () => {
    process.env.FAKE_PYTHON_MODE = "missing-pytest";
    try {
      await runTests({ dir: makeDir(), python: FAKE });
      throw new Error("ожидался reject от runTests");
    } catch (e) {
      const error = e as PracticeError;
      expect(error.message).toMatch(/pytest/i);
    }
  });
});

// Своя, отдельная от tests/fixtures/practice/fake-python.mjs подделка
// интерпретатора. Общая фикстура заточена под отбор тестов через окружение —
// у неё своя логика и свой набор переменных, и подмешивать в неё проверку
// PYTHONPATH/testFile означало бы связывать этот тест с чужой логикой отбора.
// Поэтому подготовка здесь самодостаточна: свой крошечный скрипт во временном
// каталоге, который не гоняет настоящий pytest, а просто записывает
// полученные аргументы и окружение в argv.json (рядом с cwd прогона, то есть
// в dir) и печатает минимальный валидный junit-xml, чтобы runTests разобрал
// результат и не упал.
function makeFakePython(): string {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-fake-python-"));
  const file = path.join(scriptDir, "fake-python.mjs");
  fs.writeFileSync(
    file,
    `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const junitIndex = args.indexOf("--junit-xml");
const junit = junitIndex === -1 ? null : args[junitIndex + 1];

// argv.json пишется в cwd прогона (раннер задаёт cwd: dir), а не рядом с
// junit-отчётом: каталог под junit-отчёт раннер удаляет сразу после прогона.
fs.writeFileSync(
  path.join(process.cwd(), "argv.json"),
  JSON.stringify({ args, env: process.env }),
  "utf8",
);

if (junit) {
  fs.writeFileSync(
    junit,
    '<?xml version="1.0" encoding="utf-8"?><testsuites><testsuite name="pytest" tests="0"></testsuite></testsuites>',
    "utf8",
  );
}
`,
    "utf8",
  );
  fs.chmodSync(file, 0o755);
  return file;
}

describe("runTests: каталог файлов человека попадает в PYTHONPATH", () => {
  it("добавляет каталог файлов человека в PYTHONPATH и передаёт путь тестового файла", async () => {
    const python = makeFakePython();
    const dir = makeDir();
    const nested = path.join(dir, "exercise");
    fs.mkdirSync(nested, { recursive: true });
    const testFile = path.join(dir, "test_exercise.py");

    const outcome = await runTests({ dir, python, pythonPath: nested, testFile });

    const call = JSON.parse(fs.readFileSync(path.join(dir, "argv.json"), "utf8"));
    expect(call.env.PYTHONPATH.split(path.delimiter)).toContain(nested);
    expect(call.args).toContain(testFile);
    // Подделка печатает junit с tests="0" — ровно это и обязано приехать в
    // разобранном итоге. Прежнее `toBeGreaterThanOrEqual(0)` было верно при
    // любом числе и не проверяло вообще ничего.
    expect(outcome).toMatchObject({ total: 0, passed: 0, failed: 0, errors: 0 });
  });

  it("не затирает PYTHONPATH, уже заданный в окружении, а дописывает его первым по порядку", async () => {
    const python = makeFakePython();
    const dir = makeDir();
    const nested = path.join(dir, "exercise");
    fs.mkdirSync(nested, { recursive: true });
    process.env.PYTHONPATH = "/pre-existing";
    try {
      await runTests({ dir, python, pythonPath: nested });
      const call = JSON.parse(fs.readFileSync(path.join(dir, "argv.json"), "utf8"));
      expect(call.env.PYTHONPATH.split(path.delimiter)).toEqual([nested, "/pre-existing"]);
    } finally {
      delete process.env.PYTHONPATH;
    }
  });
});
