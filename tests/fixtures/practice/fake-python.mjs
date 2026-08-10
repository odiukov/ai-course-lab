#!/usr/bin/env node
// Подделка python3 для тестов раннера: настоящий pytest в юнит-тестах не
// запускается (его может не быть на машине, и он медленный). Читает те же
// аргументы, что раннер передаёт настоящему интерпретатору, и пишет заранее
// заготовленный junit-xml. Режим задаётся переменной FAKE_PYTHON_MODE.
import fs from "node:fs";

const args = process.argv.slice(2);
const junitIndex = args.indexOf("--junit-xml");
const junit = junitIndex === -1 ? null : args[junitIndex + 1];
const filtered = args.includes("-k");
const mode = process.env.FAKE_PYTHON_MODE ?? "green";

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
    mode === "red"
      ? [ok("test_transpose_rectangular"), bad("test_transpose_twice_returns_original")]
      : mode === "empty-filter" && filtered
        ? []
        : [ok("test_transpose_rectangular"), ok("test_matmul_row_by_column")];

  if (junit) fs.writeFileSync(junit, suite(cases), "utf8");
  // pytest выходит с 5, когда не собрал ни одного теста, и с 1, когда что-то
  // упало. Раннер обязан отличать это от «интерпретатор не запустился».
  process.exit(cases.length === 0 ? 5 : mode === "red" ? 1 : 0);
}
