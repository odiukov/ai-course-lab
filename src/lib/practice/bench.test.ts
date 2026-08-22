import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
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

  it("отмена запроса прерывает замер, а не ждёт двухминутного таймаута", async () => {
    process.env.FAKE_BENCH_MODE = "hang";
    const controller = new AbortController();
    const promise = runBench({ dir: process.cwd(), python: FAKE, signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "PracticeError", kind: "timeout" });
  });

  it("уже отменённый сигнал не спавнит интерпретатор вовсе", async () => {
    await expect(
      runBench({ dir: process.cwd(), python: FAKE, signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: "PracticeError" });
  });
});

// Свой, отдельный от tests/fixtures/practice/fake-bench.mjs рекордер — как в
// run-tests.test.ts для fake-python.mjs. Общая фикстура здесь не годится: она
// только эхом отдаёт готовый отчёт и ничего не знает про свои аргументы, а
// подмешивать в неё запись argv означало бы связывать чужую фикстуру с
// проверкой, которая ей не нужна. Рекордер печатает валидный минимальный
// отчёт (а не мусор), чтобы runBench не отклонил промис и проверка аргументов
// работала одним и тем же путём независимо от того, передан флаг или нет.
function makeArgvRecorder(): { python: string; argvFile: string } {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-fake-bench-"));
  const argvFile = path.join(scriptDir, "argv.json");
  const python = path.join(scriptDir, "fake-bench-argv.mjs");
  fs.writeFileSync(
    python,
    `#!/usr/bin/env node
import fs from "node:fs";

fs.writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify({ args: process.argv.slice(2) }), "utf8");
process.stdout.write(JSON.stringify({
  exercise: "x",
  functions: [],
  ruff: { available: false, findings: [] },
}));
`,
    "utf8",
  );
  fs.chmodSync(python, 0o755);
  return { python, argvFile };
}

describe("runBench: передаёт имя модуля скрипту", () => {
  it("передаёт скрипту имя модуля упражнения", async () => {
    const { python, argvFile } = makeArgvRecorder();
    await runBench({ dir: process.cwd(), python, module: "main.py" });
    const call = JSON.parse(fs.readFileSync(argvFile, "utf8"));
    expect(call.args).toContain("--module");
    expect(call.args).toContain("main.py");
  });

  it("без module флаг не передаётся вовсе — одно-файловый вызов не меняется", async () => {
    const { python, argvFile } = makeArgvRecorder();
    await runBench({ dir: process.cwd(), python });
    const call = JSON.parse(fs.readFileSync(argvFile, "utf8"));
    expect(call.args).not.toContain("--module");
  });
});
