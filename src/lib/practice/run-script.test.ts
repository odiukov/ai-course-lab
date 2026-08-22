import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PracticeError } from "./errors";
import { runScript } from "./run-script";

function script(body: string): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-run-script-"));
  const file = path.join(dir, "main.mjs");
  fs.writeFileSync(file, body, "utf8");
  return { dir, file };
}

describe("runScript", () => {
  it("считает код выхода 0 отдельным зелёным зачётом", async () => {
    const fixture = script('console.log("workers converged")\n');
    const result = await runScript({ ...fixture, python: process.execPath });

    expect(result).toMatchObject({ passed: true, exitCode: 0 });
    expect(result.stdout).toContain("workers converged");
    expect(result.command).toContain("main.mjs");
  });

  it("возвращает красный результат и stderr при ненулевом коде", async () => {
    const fixture = script('console.error("rank drift")\nprocess.exit(7)\n');
    const result = await runScript({ ...fixture, python: process.execPath });

    expect(result).toMatchObject({ passed: false, exitCode: 7 });
    expect(result.stderr).toContain("rank drift");
  });

  it("прерывает зависший прогон по отдельному таймауту", async () => {
    const fixture = script("setInterval(() => {}, 1000)\n");
    const error = await runScript({
      ...fixture,
      python: process.execPath,
      timeoutMs: 50,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PracticeError);
    expect((error as PracticeError).kind).toBe("timeout");
  });
});
