#!/usr/bin/env node
// Подделка python3 для тестов раннера: настоящий pytest в юнит-тестах не
// запускается (его может не быть на машине, и он медленный). Читает те же
// аргументы, что раннер передаёт настоящему интерпретатору, и пишет заранее
// заготовленный junit-xml. Режим задаётся переменной FAKE_PYTHON_MODE.
import fs from "node:fs";

const args = process.argv.slice(2);
const junitIndex = args.indexOf("--junit-xml");
const junit = junitIndex === -1 ? null : args[junitIndex + 1];
const kIndex = args.indexOf("-k");
const filtered = kIndex !== -1;
const expression = filtered ? args[kIndex + 1] : null;
const mode = process.env.FAKE_PYTHON_MODE ?? "green";

// Настоящие имена тестов урока про матрицы: именно на них ломался фильтр по
// подстроке. Режим `lesson02` отбирает из них те, что выбрало бы выражение
// -k, — так проверяется отбор, а не пересказ ожиданий.
const LESSON02 = [
  "test_transpose_rectangular",
  "test_transpose_twice_returns_original",
  "test_transpose_returns_lists_not_tuples",
  "test_matmul_by_identity_changes_nothing",
  "test_matmul_row_by_column",
  "test_matmul_shapes_2x3_by_3x2",
  "test_matmul_is_not_commutative",
  "test_identity_shape_and_content",
  "test_identity_of_one",
  "test_trace_basic",
  "test_trace_of_identity_is_size",
  "test_symmetric_true",
  "test_symmetric_false",
  "test_identity_is_symmetric",
  "test_hadamard_scales_elementwise",
  "test_hadamard_differs_from_matmul",
  "test_hadamard_with_zero_mask_zeroes_everything",
];

// Семантика pytest -k: слово — это поиск подстроки в идентификаторе теста,
// плюс and / or / not и скобки. Рекурсивный спуск на десять строк вместо
// зависимости: подделке нужен ровно этот язык.
function matches(expr, name) {
  const tokens = expr.replace(/([()])/g, " $1 ").split(/\s+/).filter(Boolean);
  let at = 0;

  const parseOr = () => {
    let value = parseAnd();
    while (tokens[at] === "or") {
      at += 1;
      value = parseAnd() || value;
    }
    return value;
  };
  const parseAnd = () => {
    let value = parseNot();
    while (tokens[at] === "and") {
      at += 1;
      value = parseNot() && value;
    }
    return value;
  };
  const parseNot = () => {
    if (tokens[at] === "not") {
      at += 1;
      return !parseNot();
    }
    if (tokens[at] === "(") {
      at += 1;
      const value = parseOr();
      at += 1; // ')'
      return value;
    }
    const word = tokens[at];
    at += 1;
    return word !== undefined && name.includes(word);
  };

  return parseOr();
}

const suite = (cases) =>
  `<?xml version="1.0" encoding="utf-8"?><testsuites><testsuite name="pytest" tests="${cases.length}">${cases.join("")}</testsuite></testsuites>`;
const ok = (name) => `<testcase classname="test_exercise" name="${name}" time="0.0"/>`;
const bad = (name) =>
  `<testcase classname="test_exercise" name="${name}" time="0.0"><failure message="AssertionError">def ${name}():\nE       assert 0 == 32</failure></testcase>`;

if (mode === "missing-pytest") {
  process.stderr.write("No module named pytest\n");
  process.exit(1);
}

if (mode === "hang") {
  setTimeout(() => process.exit(0), 60_000);
} else {
  const cases =
    mode === "lesson02"
      ? LESSON02.filter((name) => (expression ? matches(expression, name) : true)).map(ok)
      : mode === "red"
        ? [ok("test_transpose_rectangular"), bad("test_transpose_twice_returns_original")]
        : mode === "empty-filter" && filtered
          ? []
          : [ok("test_transpose_rectangular"), ok("test_matmul_row_by_column")];

  if (junit) fs.writeFileSync(junit, suite(cases), "utf8");
  // Отбор — то, что проверяет тест фильтра, а junit-отчёт живёт во временном
  // каталоге и удаляется раннером. Поэтому имена отобранных тестов уходят ещё
  // и в файл, путь к которому задаёт тест.
  if (process.env.FAKE_PYTHON_SELECTED) {
    const names = cases.map((item) => /\sname="([^"]+)"/.exec(item)?.[1] ?? "");
    fs.appendFileSync(process.env.FAKE_PYTHON_SELECTED, `${names.join(",")}\n`, "utf8");
  }
  // pytest выходит с 5, когда не собрал ни одного теста, и с 1, когда что-то
  // упало. Раннер обязан отличать это от «интерпретатор не запустился».
  process.exit(cases.length === 0 ? 5 : mode === "red" ? 1 : 0);
}
