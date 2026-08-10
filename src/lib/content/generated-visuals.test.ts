import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lessonPaths } from "./paths";
import type { StepMeta } from "./step-file";
import { readGeneratedVisualIds } from "./generated-visuals";

const SLUG = "01-math-foundations__02-beta";

function drawn(id: string): StepMeta {
  return { id, type: "visual", title: id, visual_brief: `схема для ${id}` };
}

function tmpContentDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gen-ids-"));
}

describe("readGeneratedVisualIds", () => {
  it("возвращает только те шаги, чей файл лежит на диске", () => {
    const contentDir = tmpContentDir();
    const paths = lessonPaths(contentDir, SLUG);
    fs.mkdirSync(paths.visualsDir, { recursive: true });
    fs.writeFileSync(paths.visualFile("002-v"), "<svg></svg>");

    const steps = [drawn("001-t"), drawn("002-v"), drawn("003-v")];
    expect(readGeneratedVisualIds(contentDir, SLUG, steps)).toEqual(["002-v"]);
  });

  it("пустой список, когда каталога visuals нет", () => {
    const contentDir = tmpContentDir();

    expect(readGeneratedVisualIds(contentDir, SLUG, [drawn("001-t")])).toEqual([]);
  });

  it("не отдаёт схему шагу, который в текущем плане её не просил", () => {
    const contentDir = tmpContentDir();
    const paths = lessonPaths(contentDir, SLUG);
    fs.mkdirSync(paths.visualsDir, { recursive: true });
    fs.writeFileSync(paths.visualFile("004-dlina"), "<svg></svg>");

    // Файл переживает перегенерацию плана, а последовательные id
    // переиспользуются: 004-dlina вернулся теорией и чужую схему получить
    // не должен.
    const steps: StepMeta[] = [{ id: "004-dlina", type: "theory", title: "Длина вектора" }];
    expect(readGeneratedVisualIds(contentDir, SLUG, steps)).toEqual([]);
  });

  it("не отдаёт схему visual-шагу с готовой визуализацией из курса", () => {
    const contentDir = tmpContentDir();
    const paths = lessonPaths(contentDir, SLUG);
    fs.mkdirSync(paths.visualsDir, { recursive: true });
    fs.writeFileSync(paths.visualFile("004-dlina"), "<svg></svg>");

    const steps: StepMeta[] = [
      { id: "004-dlina", type: "visual", title: "Длина вектора", visual: "learning-visuals/x.html" },
    ];
    expect(readGeneratedVisualIds(contentDir, SLUG, steps)).toEqual([]);
  });
});
