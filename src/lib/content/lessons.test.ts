import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lessonSlugs } from "./lessons";

describe("lessonSlugs", () => {
  it("возвращает каталоги уроков по алфавиту", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lessons-"));
    fs.mkdirSync(path.join(dir, "lessons", "02-beta"), { recursive: true });
    fs.mkdirSync(path.join(dir, "lessons", "01-alpha"), { recursive: true });
    fs.writeFileSync(path.join(dir, "lessons", "note.txt"), "не урок");
    expect(lessonSlugs(dir)).toEqual(["01-alpha", "02-beta"]);
  });

  it("на отсутствующем каталоге возвращает пустой список, а не бросает", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lessons-"));
    expect(lessonSlugs(dir)).toEqual([]);
  });
});
