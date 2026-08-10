import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseBenchOutput, runBench } from "./bench";

const FAKE = path.join(process.cwd(), "tests/fixtures/practice/fake-bench.mjs");
const fixture = fs.readFileSync(
  path.join(process.cwd(), "tests/fixtures/practice/bench-output.json"),
  "utf8",
);

afterEach(() => {
  delete process.env.FAKE_BENCH_MODE;
});

describe("parseBenchOutput", () => {
  it("разбирает отчёт целиком", () => {
    const report = parseBenchOutput(fixture);
    expect(report.exercise).toBe("p01-l02-vectors-matrices-operations");
    expect(report.functions[0]).toMatchObject({ fn: "transpose", ratio: 2.239, status: "very-slow" });
    expect(report.functions[1].mine?.us).toBeNull();
    expect(report.ruff.findings[0].code).toBe("PERF401");
  });

  it("на вывод, который не JSON, кидает PracticeError, а не SyntaxError", () => {
    expect(() => parseBenchOutput("Traceback ...")).toThrow(/замер/i);
  });

  it("на JSON не той формы тоже кидает PracticeError", () => {
    expect(() => parseBenchOutput('{"functions": "нет"}')).toThrow(/замер/i);
  });
});

describe("runBench", () => {
  it("спавнит интерпретатор и отдаёт разобранный отчёт", async () => {
    const report = await runBench({ dir: process.cwd(), python: FAKE });
    expect(report.functions).toHaveLength(2);
  });

  it("падение интерпретатора превращается в PracticeError", async () => {
    process.env.FAKE_BENCH_MODE = "garbage";
    await expect(runBench({ dir: process.cwd(), python: FAKE })).rejects.toMatchObject({
      name: "PracticeError",
    });
  });
});
