import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lessonPaths } from "./paths";
import { readGeneratedVisualIds } from "./generated-visuals";

const SLUG = "01-math-foundations__02-beta";

describe("readGeneratedVisualIds", () => {
  it("возвращает только те шаги, чей файл лежит на диске", () => {
    const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-ids-"));
    const paths = lessonPaths(contentDir, SLUG);
    fs.mkdirSync(paths.visualsDir, { recursive: true });
    fs.writeFileSync(paths.visualFile("002-v"), "<svg></svg>");

    expect(readGeneratedVisualIds(contentDir, SLUG, ["001-t", "002-v", "003-v"])).toEqual(["002-v"]);
  });

  it("пустой список, когда каталога visuals нет", () => {
    const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-ids-"));

    expect(readGeneratedVisualIds(contentDir, SLUG, ["001-t"])).toEqual([]);
  });
});
