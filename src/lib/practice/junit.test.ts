import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { decisiveLine, parseJunitXml } from "./junit";

const fixture = fs.readFileSync(
  path.join(process.cwd(), "tests/fixtures/practice/junit-failed.xml"),
  "utf8",
);

describe("parseJunitXml", () => {
  it("считает по самим testcase, а не по атрибутам набора", () => {
    const outcome = parseJunitXml(fixture);
    expect(outcome).toMatchObject({ total: 4, failed: 2, skipped: 1, errors: 0, passed: 1 });
  });

  it("отдаёт упавшие тесты по порядку с их сообщением", () => {
    const [first, second] = parseJunitXml(fixture).failures;
    expect(first.name).toBe("test_transpose_rectangular");
    expect(first.message).toBe("NotImplementedError");
    expect(first.decisive).toBe("E       NotImplementedError");
    expect(second.decisive).toBe("E       assert [[1, 4], [2, 5]] == [[1, 2], [4, 5]]");
  });

  it("пустой набор — это ноль тестов, а не ошибка разбора", () => {
    const empty =
      '<?xml version="1.0" encoding="utf-8"?><testsuites><testsuite name="pytest" errors="0" failures="0" skipped="0" tests="0" time="0.01"/></testsuites>';
    expect(parseJunitXml(empty)).toMatchObject({ total: 0, passed: 0, failed: 0, failures: [] });
  });

  it("единственный testcase не теряется из-за того, что это не массив", () => {
    const one =
      '<?xml version="1.0"?><testsuites><testsuite tests="1"><testcase classname="t" name="test_one" time="0.0"/></testsuite></testsuites>';
    expect(parseJunitXml(one)).toMatchObject({ total: 1, passed: 1 });
  });

  it("<error> считается отдельно от <failure>", () => {
    const broken =
      '<?xml version="1.0"?><testsuites><testsuite tests="1"><testcase classname="t" name="test_boom" time="0.0"><error message="collection error">ImportError</error></testcase></testsuite></testsuites>';
    const outcome = parseJunitXml(broken);
    expect(outcome).toMatchObject({ total: 1, errors: 1, failed: 0, passed: 0 });
    expect(outcome.failures[0].name).toBe("test_boom");
  });

  it("обрабатывает <failure> без атрибутов — только текст", () => {
    const attributeless =
      '<?xml version="1.0"?><testsuites><testsuite tests="1"><testcase classname="t" name="test_noattr" time="0.0"><failure>TypeError: cannot add None to int</failure></testcase></testsuite></testsuites>';
    const outcome = parseJunitXml(attributeless);
    expect(outcome).toMatchObject({ total: 1, failed: 1, passed: 0 });
    const failure = outcome.failures[0];
    expect(failure.name).toBe("test_noattr");
    expect(failure.text).toBe("TypeError: cannot add None to int");
    expect(failure.decisive).toBe("TypeError: cannot add None to int");
  });
});

describe("decisiveLine", () => {
  it("берёт последнюю строку с E — в ней pytest печатает суть", () => {
    expect(decisiveLine("foo\nE       assert 0 == 32\nbar")).toBe("E       assert 0 == 32");
  });

  it("когда несколько E-строк — берёт последнюю, не первую", () => {
    expect(decisiveLine("E first candidate\nnoise\nE second candidate")).toBe("E second candidate");
  });

  it("без строк с E берёт последнюю значимую", () => {
    expect(decisiveLine("first\n\nlast\n\n")).toBe("last");
  });

  it("длинную строку обрезает", () => {
    expect(decisiveLine(`E ${"x".repeat(400)}`).length).toBeLessThanOrEqual(200);
  });
});
