import { XMLParser } from "fast-xml-parser";

export interface TestFailure {
  name: string;
  message: string;
  /** Одна строка, которую человеку достаточно прочитать. */
  decisive: string;
  /** Полный текст падения, обрезанный: он уходит в промпт разбора. */
  text: string;
}

export interface TestOutcome {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  failures: TestFailure[];
}

const MAX_DECISIVE = 200;
const MAX_TEXT = 4000;

// Строки с ведущим `E` pytest печатает там, где сформулирована суть падения:
// `E   assert 0 == 32`. Последняя, а не первая: у цепочки вызовов сначала идут
// строки вызывающего кода, и суть оказывается ниже.
export function decisiveLine(text: string): string {
  const lines = text.split("\n").map((line) => line.replace(/\s+$/, ""));
  const meaningful = lines.filter((line) => line.trim().length > 0);
  const marked = meaningful.filter((line) => /^E\s/.test(line.trim()) || line.startsWith("E "));
  const chosen = marked.at(-1) ?? meaningful.at(-1) ?? "";
  return chosen.length > MAX_DECISIVE ? `${chosen.slice(0, MAX_DECISIVE - 1)}…` : chosen;
}

interface RawFailure {
  "@message"?: string;
  "#text"?: string;
}

type RawFailureValue = RawFailure | string;

interface RawCase {
  "@name"?: string;
  failure?: RawFailureValue[];
  error?: RawFailureValue[];
  skipped?: unknown[];
}

interface RawSuite {
  testcase?: RawCase[];
}

interface RawRoot {
  testsuites?: { testsuite?: RawSuite[] }[];
  testsuite?: RawSuite[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // Без этого единственный <testcase> приезжает объектом, а не массивом, и
  // прогон с одним тестом читался бы как ноль тестов.
  isArray: (name) => ["testsuites", "testsuite", "testcase", "failure", "error", "skipped"].includes(name),
});

function toFailure(name: string, raw: RawFailureValue): TestFailure {
  // Если raw — просто строка (элемент без атрибутов вроде <failure>ImportError</failure>),
  // используем её как текст; иначе достаём из объекта.
  const text = typeof raw === "string"
    ? String(raw).slice(0, MAX_TEXT)
    : String(raw["#text"] ?? "").slice(0, MAX_TEXT);

  const message = typeof raw === "string"
    ? ""
    : String(raw["@message"] ?? "").trim();

  return {
    name,
    message,
    decisive: decisiveLine(text || message),
    text,
  };
}

export function parseJunitXml(xml: string): TestOutcome {
  const root = parser.parse(xml) as RawRoot;
  const suites = [
    ...(root.testsuites ?? []).flatMap((wrapper) => wrapper.testsuite ?? []),
    ...(root.testsuite ?? []),
  ];
  const cases = suites.flatMap((suite) => suite.testcase ?? []);

  const failures: TestFailure[] = [];
  let failed = 0;
  let errors = 0;
  let skipped = 0;

  for (const item of cases) {
    const name = String(item["@name"] ?? "(без имени)");
    if (item.failure?.length) {
      failed += 1;
      failures.push(toFailure(name, item.failure[0]));
    } else if (item.error?.length) {
      errors += 1;
      failures.push(toFailure(name, item.error[0]));
    } else if (item.skipped?.length) {
      skipped += 1;
    }
  }

  return {
    total: cases.length,
    passed: cases.length - failed - errors - skipped,
    failed,
    errors,
    skipped,
    failures,
  };
}
