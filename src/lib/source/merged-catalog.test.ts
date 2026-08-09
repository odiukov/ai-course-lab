import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findLesson } from "./catalog";
import { importLesson } from "./import-lesson";
import { readMergedCatalog } from "./merged-catalog";

const COURSE = path.resolve(__dirname, "../../../tests/fixtures/course");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "merged-"));
}

describe("readMergedCatalog", () => {
  it("показывает весь курс и помечает импортированные уроки", () => {
    const sourceDir = tmp();
    importLesson(COURSE, sourceDir, findLesson(COURSE, "01-math-foundations__02-beta")!);

    const phases = readMergedCatalog(sourceDir, COURSE);
    const lessons = phases.flatMap((phase) => phase.lessons);
    expect(lessons).toHaveLength(3);
    expect(lessons.find((l) => l.slug === "01-math-foundations__02-beta")?.imported).toBe(true);
    expect(lessons.find((l) => l.slug === "01-math-foundations__01-alpha")?.imported).toBe(false);
  });

  it("без старого репозитория показывает только импортированное", () => {
    const sourceDir = tmp();
    importLesson(COURSE, sourceDir, findLesson(COURSE, "01-math-foundations__02-beta")!);

    const lessons = readMergedCatalog(sourceDir, null).flatMap((phase) => phase.lessons);
    expect(lessons).toHaveLength(1);
    expect(lessons[0].imported).toBe(true);
  });

  it("на пустом проекте без старого репозитория отдаёт пустой список", () => {
    expect(readMergedCatalog(tmp(), null)).toEqual([]);
  });
});
