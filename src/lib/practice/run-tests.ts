import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTopLevelFunctions } from "../source/written-functions";
import { PracticeError } from "./errors";
import { parseJunitXml, type TestOutcome } from "./junit";

export const TESTS_TIMEOUT_MS = 60_000;

export interface RunTestsOptions {
  dir: string;
  fn?: string;
  /**
   * Канонический состав упражнения — имена из `exercise.template.py`
   * (readCanonicalFunctions), а не из файла учащегося. Нужны, чтобы фильтр -k
   * выбрал набор именно `fn`, а не всё, в чьё имя подстрокой попало имя
   * функции. Список из живого exercise.py сюда передавать нельзя: собственная
   * вспомогательная функция учащегося попала бы в отрицание и отрезала тесты
   * самого шага.
   */
  functions?: string[];
  python?: string;
  timeoutMs?: number;
  /** Каталог, который добавляется в PYTHONPATH: файлы человека в каталожной форме. */
  pythonPath?: string;
  /** Путь тестового файла, если он не в cwd прогона. */
  testFile?: string;
  /** Точные pytest node IDs из exercise.json; для unittest заменяют эвристику -k. */
  testNodes?: string[];
}

/**
 * Собирает выражение для `pytest -k`.
 *
 * `-k` сравнивает подстроку с целым идентификатором теста, поэтому одного
 * имени функции мало: на уроке про матрицы `-k identity` выбирает ещё и
 * `test_matmul_by_identity_changes_nothing`, `test_trace_of_identity_is_size`,
 * `test_identity_is_symmetric` — тесты, которые зовут функции, не написанные
 * к этому шагу, и красят шаг в красный за чужую заготовку. Обратный случай не
 * лучше: если собственные тесты `is_symmetric` ошибочно назвать
 * `test_symmetric_*`, то `-k is_symmetric` выберет только интеграционный
 * `test_identity_is_symmetric` и даст зелёный вердикт на непроверенном коде.
 *
 * Поэтому выражение — это «имя функции И НЕ любое из остальных имён этого же
 * упражнения». Имена, которые сами являются подстрокой `fn`
 * (`matmul` внутри `matmul_fast`), из отрицания выкидываются: иначе они
 * обнулили бы весь отбор. Если после такой фильтрации в отборе не осталось
 * ни одного теста, runTests честно гоняет весь файл с предупреждением — это
 * лучше, чем зелёный вердикт по одному случайно совпавшему тесту.
 */
export function buildTestFilter(fn: string, functions: string[] = []): string {
  const others = [...new Set(functions)].filter((name) => name !== fn && !fn.includes(name));
  if (others.length === 0) return fn;
  return `${fn} and not (${others.join(" or ")})`;
}

/**
 * Тесты, которые прямо вызывают функцию шага.
 *
 * Имена старых тестов не всегда повторяют полное имя функции:
 * `flow_matching_loss` проверяют `test_loss_*`. Смотрим на тело теста, а не
 * только на заголовок. Сначала предпочитаем изолированные тесты; если их нет,
 * оставляем интеграционные, которые действительно доходят до нужной функции,
 * вместо прогона всего упражнения.
 */
export function selectDirectTestNames(
  source: string,
  fn: string,
  functions: string[] = [],
): string[] {
  const canonical = [...new Set(functions.length > 0 ? functions : [fn])];
  const others = canonical.filter((name) => name !== fn && !fn.includes(name));
  const blocks = parseTopLevelFunctions(source);
  const byName = new Map(blocks.map((block) => [block.fn, block]));
  const calls = (body: string, name: string) =>
    new RegExp(`(^|[^A-Za-z0-9_])${name}\\s*\\(`, "m").test(body);
  const reaches = (blockName: string, target: string, seen = new Set<string>()): boolean => {
    if (seen.has(blockName)) return false;
    seen.add(blockName);
    const block = byName.get(blockName);
    if (!block) return false;
    const body = block.body
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    if (calls(body, target)) return true;
    return [...byName.keys()].some(
      (helper) => calls(body, helper) && reaches(helper, target, new Set(seen)),
    );
  };

  const direct = blocks.filter(
    (block) => block.fn.startsWith("test_") && reaches(block.fn, fn),
  );
  const isolated = direct.filter(
    (block) => !others.some((name) => reaches(block.fn, name)),
  );
  return (isolated.length > 0 ? isolated : direct).map((block) => block.fn);
}

export interface TestRunResult extends TestOutcome {
  /** Гонялся ли только набор текущей функции. */
  filtered: boolean;
  warning: string | null;
  command: string;
  stdout: string;
}

interface RawRun {
  code: number | null;
  stdout: string;
  stderr: string;
  xml: string | null;
}

function spawnOnce(opts: {
  python: string;
  dir: string;
  filter?: string;
  junit: string;
  timeoutMs: number;
  pythonPath?: string;
  testFile?: string;
  testNodes?: string[];
}): Promise<RawRun> {
  const junit = opts.junit;
  const args = ["-m", "pytest", "-q", "--no-header", "--junit-xml", junit];
  if (opts.testNodes && opts.testNodes.length > 0) args.push(...opts.testNodes);
  else if (opts.testFile) args.push(opts.testFile);
  if (opts.filter) args.push("-k", opts.filter);

  // PYTHONPATH, а не cwd: тесты курса лежат в каталоге упражнения и
  // импортируют модули по имени (`from main import ...`). Файлы человека в
  // каталожной форме живут в exercise/, и без этого пути pytest подхватил бы
  // либо ничего, либо соседний solution/. Существующее значение сохраняется:
  // затирать окружение машины ради своей строки нельзя.
  const env = opts.pythonPath
    ? {
        ...process.env,
        PYTHONPATH: [opts.pythonPath, process.env.PYTHONPATH]
          .filter((part) => part && part.length > 0)
          .join(path.delimiter),
      }
    : process.env;

  return new Promise((resolve, reject) => {
    const child = spawn(opts.python, args, { cwd: opts.dir, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new PracticeError(
          `Прогон тестов не закончился за ${Math.round(opts.timeoutMs / 1000)} с и был прерван`,
          "timeout",
        ),
      );
    }, opts.timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new PracticeError(`Не удалось запустить ${opts.python}: ${error.message}`, "spawn"));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr,
        xml: fs.existsSync(junit) ? fs.readFileSync(junit, "utf8") : null,
      });
    });
  });
}

// Каталог под junit-отчёт живёт ровно один прогон: без finally за вечер в
// /tmp остаётся по каталогу lab-junit-* на каждое нажатие «Прогнать тесты».
async function spawnPytest(opts: {
  python: string;
  dir: string;
  filter?: string;
  timeoutMs: number;
  pythonPath?: string;
  testFile?: string;
  testNodes?: string[];
}): Promise<RawRun> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lab-junit-"));
  try {
    return await spawnOnce({ ...opts, junit: path.join(tmp, "report.xml") });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function toOutcome(run: RawRun, python: string): TestOutcome {
  if (run.xml === null) {
    // Ни отчёта, ни тестов: интерпретатор не дошёл до прогона. Единственный
    // случай, когда виноват не код учащегося, а окружение.
    const reason = (run.stderr || run.stdout).trim().split("\n").slice(-3).join(" ");
    throw new PracticeError(
      `${python} не оставил junit-отчёта (код ${run.code}). ${reason}`,
      "python",
    );
  }
  try {
    return parseJunitXml(run.xml);
  } catch (error) {
    throw new PracticeError(`Не удалось разобрать junit-отчёт: ${(error as Error).message}`, "output");
  }
}

export async function runTests(options: RunTestsOptions): Promise<TestRunResult> {
  const python = options.python ?? "python3";
  const timeoutMs = options.timeoutMs ?? TESTS_TIMEOUT_MS;
  const describe = (filter?: string, nodes?: string[]) =>
    `${python} -m pytest -q --no-header${
      nodes && nodes.length > 0 ? ` ${nodes.join(" ")}` : filter ? ` -k "${filter}"` : ""
    }`;
  const testFile = options.testFile ?? path.join(options.dir, "test_exercise.py");
  const direct =
    !options.testNodes && options.fn && fs.existsSync(testFile)
      ? selectDirectTestNames(fs.readFileSync(testFile, "utf8"), options.fn, options.functions)
      : [];
  const filter = !options.testNodes && options.fn
    ? direct.length > 0
      ? direct.join(" or ")
      : buildTestFilter(options.fn, options.functions)
    : undefined;

  const first = toOutcome(
    await spawnPytest({
      python,
      dir: options.dir,
      filter,
      timeoutMs,
      pythonPath: options.pythonPath,
      testFile: options.testFile,
      testNodes: options.testNodes,
    }),
    python,
  );

  if (options.testNodes || !filter || first.total > 0) {
    return {
      ...first,
      filtered: Boolean(filter || options.testNodes?.length),
      warning: null,
      command: describe(filter, options.testNodes),
      stdout: "",
    };
  }

  // Соглашение об именах тестов нарушено в этом упражнении: фильтр не выбрал
  // ничего. Молча показать «0 из 0 зелёные» нельзя, гнать пустоту тоже —
  // гоняем весь файл и говорим об этом прямым текстом.
  const full = toOutcome(
    await spawnPytest({
      python,
      dir: options.dir,
      timeoutMs,
      pythonPath: options.pythonPath,
      testFile: options.testFile,
    }),
    python,
  );
  return {
    ...full,
    filtered: false,
    warning: `Фильтр -k ${options.fn} не выбрал ни одного теста — прогнан весь файл. Похоже, тесты этого упражнения названы не по образцу test_<функция>_<случай>.`,
    command: describe(undefined),
    stdout: "",
  };
}
