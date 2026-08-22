import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readExerciseFiles } from "@/lib/exercise/file";
import { canonicalFunctions, readExerciseTree, type ExerciseTree } from "@/lib/exercise/tree";
import type { LessonRef } from "@/lib/source/catalog";
import { runBench } from "./bench";
import { runTests } from "./run-tests";

/**
 * Этот файл гоняет НАСТОЯЩИЙ python3/pytest, а не подделку из
 * tests/fixtures/practice/fake-python.mjs. Остальные тесты по соседству
 * (run-tests.test.ts) проверяют, как runTests РАЗБИРАЕТ вывод интерпретатора —
 * подделка для этого и создана, она печатает заранее заданный junit-xml.
 * Здесь проверяется другое: что многофайловое упражнение (шаблон в
 * exercise.template/, решение в solution/, файлы человека в exercise/,
 * тесты, импортирующие сразу два модуля) вообще ЗАПУСКАЕТСЯ под настоящим
 * pytest — PYTHONPATH подхватывает правильный каталог, импорт `from rules
 * import ...` резолвится, junit-отчёт настоящего интерпретатора парсится —
 * и что двусторонняя гарантия (эталон зелёный, шаблон красный на тех же
 * тестах) держится на реальном инструменте, а не только в разборе фикстур.
 * Подделка интерпретатора здесь ничего бы не доказала: она бы просто вернула
 * то, что ей сказали вернуть.
 *
 * Skip-логики «если python3/pytest не найден» здесь нет и не должно быть:
 * они обязательны для практики курса в принципе (см. src/lib/practice/health.ts),
 * и тихий скип на машине без них превратил бы этот тест в декорацию, а не
 * приёмку.
 */

// Реальный pytest — это процесс: запуск интерпретатора, импорт двух модулей,
// сбор тестов, запись junit-отчёта. На этой машине один прогон занимает
// заметно меньше секунды, но дефолтный таймаут vitest (5с) — это уже риск на
// чужом железе или под нагрузкой. Поднимаем таймаут явно для тех it(), что
// зовут runTests, а не для всего файла.
const REAL_PYTEST_TIMEOUT_MS = 20_000;

const REF: LessonRef = {
  slug: "19-capstone-projects__83-rule-matcher",
  phaseDir: "19-capstone-projects",
  lessonDir: "83-rule-matcher",
  phaseNumber: 19,
  lessonNumber: 83,
  title: "Rule Matcher",
};

const RULES_TEMPLATE = `def load_rules(raw):
    raise NotImplementedError
`;

const RULES_SOLUTION = `def load_rules(raw):
    return [line.strip().lower() for line in raw.splitlines() if line.strip()]
`;

const MAIN_TEMPLATE = `from rules import load_rules


def normalize(text):
    raise NotImplementedError


def matches(text, raw_patterns):
    raise NotImplementedError
`;

const MAIN_SOLUTION = `from rules import load_rules


def normalize(text):
    return text.strip().lower()


def matches(text, raw_patterns):
    normalized = normalize(text)
    patterns = load_rules(raw_patterns)
    return [pattern for pattern in patterns if pattern in normalized]
`;

// Имена тестов — по образцу test_<функция>_<случай>, на который опирается
// buildTestFilter. По две пары на функцию: одной было бы достаточно для
// зелёного прогона, но недостаточно, чтобы показать, что отбор шага реально
// что-то ОТБИРАЕТ, а не просто гоняет единственный имеющийся тест.
const TEST_EXERCISE = `from main import normalize, matches
from rules import load_rules


def test_normalize_strips_whitespace():
    assert normalize("  Hello  ") == "hello"


def test_normalize_lowercases():
    assert normalize("HELLO") == "hello"


def test_matches_finds_pattern():
    assert matches("this text contains spam word", "spam\\nham") == ["spam"]


def test_matches_returns_empty_when_no_match():
    assert matches("this text is clean", "spam\\nham") == []


def test_load_rules_splits_lines():
    assert load_rules("Spam\\nHam\\n") == ["spam", "ham"]


def test_load_rules_skips_blank_lines():
    assert load_rules("spam\\n\\n\\nham\\n") == ["spam", "ham"]
`;

/**
 * Каталожная форма упражнения во временном каталоге: exercise.template/ и
 * solution/ с двумя модулями (main.py импортирует rules.py — та самая
 * межфайловая связь, из-за которой build 83 из брифа падал вне дерева курса)
 * и test_exercise.py, который импортирует из обоих модулей сразу.
 */
function makeExerciseSourceDir(): string {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-multi-file-"));
  const dir = path.join(sourceDir, "learning-exercises", "p19-l83-rule-matcher");
  fs.mkdirSync(path.join(dir, "exercise.template"), { recursive: true });
  fs.mkdirSync(path.join(dir, "solution"), { recursive: true });

  fs.writeFileSync(path.join(dir, "exercise.template", "rules.py"), RULES_TEMPLATE, "utf8");
  fs.writeFileSync(path.join(dir, "exercise.template", "main.py"), MAIN_TEMPLATE, "utf8");
  fs.writeFileSync(path.join(dir, "solution", "rules.py"), RULES_SOLUTION, "utf8");
  fs.writeFileSync(path.join(dir, "solution", "main.py"), MAIN_SOLUTION, "utf8");
  fs.writeFileSync(path.join(dir, "test_exercise.py"), TEST_EXERCISE, "utf8");

  return sourceDir;
}

/**
 * Материализует exercise/ через readExerciseFiles (тот же путь, которым
 * заводит файлы человека настоящий редактор — копия из шаблона при первом
 * обращении), затем при необходимости подменяет их содержимым эталона.
 * Так тест зовёт ровно те помощники, которыми пользуется приложение, а не
 * пишет файлы человека напрямую мимо них.
 */
function materialize(sourceDir: string, useSolution: boolean): ExerciseTree {
  const tree = readExerciseTree(sourceDir, REF)!;
  const files = readExerciseFiles(sourceDir, REF)!; // заводит exercise/ из шаблона

  if (useSolution) {
    for (const file of tree.files) {
      const state = files.files.find((item) => item.name === file.name)!;
      fs.copyFileSync(file.solutionPath!, state.file);
    }
  }

  return tree;
}

function runOptions(tree: ExerciseTree, fn?: string) {
  return {
    dir: tree.dir,
    fn,
    functions: canonicalFunctions(tree).map((pair) => pair.fn),
    python: "python3",
    pythonPath: path.join(tree.dir, "exercise"),
    testFile: tree.testPath!,
  };
}

describe("многофайловое упражнение под настоящим pytest", () => {
  it(
    "эталон (solution/): все тесты проходят, ничего не падает",
    async () => {
      const sourceDir = makeExerciseSourceDir();
      const tree = materialize(sourceDir, true);

      const result = await runTests(runOptions(tree));

      expect(result).toMatchObject({ total: 6, passed: 6, failed: 0, errors: 0 });
      expect(result.failures).toEqual([]);
    },
    REAL_PYTEST_TIMEOUT_MS,
  );

  it(
    "шаблон (exercise.template/): прогон красный на NotImplementedError — это и есть двусторонняя гарантия",
    async () => {
      const sourceDir = makeExerciseSourceDir();
      const tree = materialize(sourceDir, false);

      const result = await runTests(runOptions(tree));

      expect(result.total).toBe(6);
      expect(result.passed).toBe(0);
      // Зелёный прогон здесь означал бы, что убранные тела функций не
      // покрыты тестами вовсе — не менее важная находка, чем красный.
      expect(result.failed + result.errors).toBe(6);
      for (const failure of result.failures) {
        expect(`${failure.text}${failure.message}`).toContain("NotImplementedError");
      }
    },
    REAL_PYTEST_TIMEOUT_MS,
  );

  it(
    "отбор шага для функции из rules.py гоняет только её тесты, несмотря на межфайловый импорт",
    async () => {
      const sourceDir = makeExerciseSourceDir();
      const tree = materialize(sourceDir, true);

      const result = await runTests(runOptions(tree, "load_rules"));

      expect(result.filtered).toBe(true);
      expect(result.warning).toBeNull();
      expect(result.total).toBe(2);
      expect(result.passed).toBe(2);
    },
    REAL_PYTEST_TIMEOUT_MS,
  );
});

// Входы для scripts/bench.py: без bench.py в каталоге упражнения замер не
// вызывает функции вовсе (call_args = None) и меряет только AST — а здесь
// проверяется именно ВЫЗОВ, то есть то, какой модуль исполнился.
const BENCH_SPEC = `BENCH = {
    "normalize": ["  Spam Here  "],
    "matches": ["this text contains spam word", "spam\\nham"],
}
`;

// Замер живёт в отдельном процессе python и, в отличие от pytest, ещё и
// дёргает ruff через uvx. На этой машине полный прогон — около секунды, но
// дефолтные 5с vitest на чужом железе — риск.
const REAL_BENCH_TIMEOUT_MS = 60_000;

/**
 * Тот же настоящий scripts/bench.py, что зовёт маршрут разбора, — на
 * каталожной форме.
 *
 * Здесь ловится не «работает ли замер вообще», а ровно одна вещь: КАКОЙ модуль
 * исполнился под каждым именем. Файл человека лежит в exercise/, эталон — в
 * solution/, и оба зовут соседа `from rules import load_rules`. Корень
 * упражнения на sys.path (как было) не находит соседа вовсе. Оба каталога на
 * sys.path сразу — хуже: имя `rules` разрешилось бы в первый по порядку, и
 * «эталон» исполнял бы код учащегося, показывая ×1.00 на любом решении.
 *
 * Фикстура разводит эти случаи так, что подмена видна в числах: у человека
 * main.py уже написан (копия эталонного), а rules.py — ещё заготовка с
 * NotImplementedError. Значит `matches` замеряется у эталона и НЕ замеряется у
 * человека — но только если каждый модуль импортировал СВОЕГО соседа. Любая
 * подмена ломает ровно одно из двух чисел.
 */
function materializeMixed(sourceDir: string): ExerciseTree {
  const tree = readExerciseTree(sourceDir, REF)!;
  const files = readExerciseFiles(sourceDir, REF)!; // заводит exercise/ из шаблона
  const main = tree.files.find((item) => item.name === "main.py")!;
  const mainState = files.files.find((item) => item.name === "main.py")!;
  fs.copyFileSync(main.solutionPath!, mainState.file);
  fs.writeFileSync(path.join(tree.dir, "bench.py"), BENCH_SPEC, "utf8");
  return tree;
}

describe("многофайловое упражнение под настоящим scripts/bench.py", () => {
  it(
    "каждый модуль импортирует своего соседа: эталон замерен, недописанный файл человека — нет",
    async () => {
      const sourceDir = makeExerciseSourceDir();
      const tree = materializeMixed(sourceDir);

      // Отчёт вообще приехал — значит `from rules import load_rules`
      // разрешился при загрузке обоих модулей. До починки здесь был
      // ModuleNotFoundError, код возврата 2 и PracticeError вместо отчёта.
      const report = await runBench({ dir: tree.dir, module: "main.py", python: "python3" });
      const rows = new Map(report.functions.map((row) => [row.fn, row]));

      expect([...rows.keys()].sort()).toEqual(["matches", "normalize"]);

      // normalize соседа не зовёт — замерен с обеих сторон.
      expect(typeof rows.get("normalize")!.mine!.us).toBe("number");
      expect(typeof rows.get("normalize")!.ref.us).toBe("number");

      // matches зовёт load_rules. У эталона сосед написан — число есть.
      expect(typeof rows.get("matches")!.ref.us).toBe("number");
      // У человека тот же сосед ещё заготовка — числа нет. Это и доказывает,
      // что каталоги не смешались: подмена в любую сторону испортила бы ровно
      // одно из этих двух ожиданий.
      expect(rows.get("matches")!.written).toBe(false);
      expect(rows.get("matches")!.mine!.us).toBeNull();
      expect(rows.get("matches")!.status).toBe("unknown");
    },
    REAL_BENCH_TIMEOUT_MS,
  );

  // Одно-файловая форма — 396 упражнений курса: вызов без --module обязан
  // остаться тем же, что и был, включая каталог на пути импорта.
  it(
    "одно-файловая форма: вызов без --module меряет exercise.py против solution.py как раньше",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-single-file-bench-"));
      fs.writeFileSync(
        path.join(dir, "exercise.py"),
        "def normalize(text):\n    return text.strip().lower()\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(dir, "solution.py"),
        "def normalize(text):\n    return text.strip().lower()\n",
        "utf8",
      );
      fs.writeFileSync(path.join(dir, "bench.py"), 'BENCH = {"normalize": ["  Hi  "]}\n', "utf8");

      const report = await runBench({ dir, python: "python3" });

      expect(report.functions).toHaveLength(1);
      expect(report.functions[0].fn).toBe("normalize");
      expect(typeof report.functions[0].mine!.us).toBe("number");
      expect(typeof report.functions[0].ref.us).toBe("number");
    },
    REAL_BENCH_TIMEOUT_MS,
  );
});
