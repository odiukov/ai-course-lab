import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LessonRef } from "@/lib/source/catalog";
import { findPreviousImplementation, insertPreviousImplementation } from "./recall";

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
  write("p05-l02-delta", ["def matmul(A, B):", "    raise NotImplementedError", ""].join("\n"));
  return sourceDir;
}

const gammaRef: LessonRef = {
  slug: "10-test__01-gamma",
  phaseDir: "10-test",
  lessonDir: "01-gamma",
  phaseNumber: 10,
  lessonNumber: 1,
  title: "Gamma",
};

const deltaRef: LessonRef = {
  slug: "05-test__02-delta",
  phaseDir: "05-test",
  lessonDir: "02-delta",
  phaseNumber: 5,
  lessonNumber: 2,
  title: "Delta",
};

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

describe("insertPreviousImplementation", () => {
  it("если в упражнении этого урока нет такой функции, отдаёт ошибку и не трогает файл", () => {
    const sourceDir = makeSource();
    const previous = findPreviousImplementation(sourceDir, "softmax", "p10-l01-gamma")!;
    const deltaFile = path.join(sourceDir, "learning-exercises", "p05-l02-delta", "exercise.py");
    const before = fs.readFileSync(deltaFile, "utf8");

    const result = insertPreviousImplementation(sourceDir, deltaRef, "softmax", previous);

    expect(result).toEqual({ error: expect.stringContaining("softmax") });
    expect(fs.readFileSync(deltaFile, "utf8")).toBe(before);
  });

  it("вставляет прошлый код на место заготовки и пишет файл на диск", () => {
    const sourceDir = makeSource();
    const previous = findPreviousImplementation(sourceDir, "softmax", "p10-l01-gamma")!;
    const gammaFile = path.join(sourceDir, "learning-exercises", "p10-l01-gamma", "exercise.py");

    const result = insertPreviousImplementation(sourceDir, gammaRef, "softmax", previous);

    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error("unreachable");
    expect(result.code).toContain("sum(xs) or 1");
    expect(result.functions).toEqual([
      { fn: "softmax", signature: "softmax(xs)", startLine: 1, endLine: 3, implemented: true },
    ]);
    expect(fs.readFileSync(gammaFile, "utf8")).toBe(result.code);
  });
});
