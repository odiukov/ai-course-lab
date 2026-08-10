import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findPreviousImplementation } from "./recall";

const SOLVED = [
  "def softmax(xs):",
  "    total = sum(xs)",
  "    return [x / total for x in xs]",
  "",
].join("\n");

const STUB = ["def softmax(xs):", "    raise NotImplementedError", ""].join("\n");

function makeSource(): string {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-recall-"));
  const write = (exerciseSlug: string, code: string) => {
    const dir = path.join(sourceDir, "learning-exercises", exerciseSlug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "exercise.py"), code, "utf8");
  };
  write("p02-l04-alpha", SOLVED);
  write("p07-l03-beta", SOLVED.replace("sum(xs)", "sum(xs) or 1"));
  write("p10-l01-gamma", STUB);
  return sourceDir;
}

describe("findPreviousImplementation", () => {
  it("берёт самую свежую написанную реализацию", () => {
    const found = findPreviousImplementation(makeSource(), "softmax", "p10-l01-gamma")!;
    expect(found.exerciseSlug).toBe("p07-l03-beta");
    expect(found.code).toContain("sum(xs) or 1");
  });

  it("текущее упражнение исключается, даже если функция в нём написана", () => {
    const sourceDir = makeSource();
    const found = findPreviousImplementation(sourceDir, "softmax", "p07-l03-beta")!;
    expect(found.exerciseSlug).toBe("p02-l04-alpha");
  });

  it("незаполненная заготовка не считается написанной", () => {
    expect(findPreviousImplementation(makeSource(), "softmax", "p02-l04-alpha")?.exerciseSlug).toBe(
      "p07-l03-beta",
    );
  });

  it("если функция нигде не написана, отдаёт null", () => {
    expect(findPreviousImplementation(makeSource(), "matmul", "p10-l01-gamma")).toBeNull();
  });
});
