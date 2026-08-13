import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StepMeta } from "../content/step-file";
import { collectVisualRefs } from "./visual-refs";

let root: string;
let contentDir: string;
let sourceDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "visual-refs-"));
  contentDir = path.join(root, "content");
  sourceDir = path.join(root, "source");
  fs.mkdirSync(path.join(contentDir, "lessons", "lesson-a", "visuals"), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, "learning-visuals"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function collect(steps: StepMeta[]) {
  return collectVisualRefs({
    steps,
    slug: "lesson-a",
    contentDir,
    sourceDir,
    basePath: "/ai-course-lab",
  });
}

describe("collectVisualRefs", () => {
  it("puts a course visual and a generated visual in separate places", () => {
    fs.writeFileSync(
      path.join(sourceDir, "learning-visuals", "lesson-02-shapes.html"),
      "<html></html>",
    );
    fs.writeFileSync(
      path.join(contentDir, "lessons", "lesson-a", "visuals", "003-tangent.html"),
      "<html></html>",
    );

    const { refs, hrefByStepId } = collect([
      {
        id: "002-course",
        type: "visual",
        title: "Из курса",
        visual: "learning-visuals/lesson-02-shapes.html",
      },
      { id: "003-tangent", type: "visual", title: "Своя", visual_brief: "касательная" },
    ]);

    expect(hrefByStepId["002-course"]).toBe("/ai-course-lab/visuals/course/lesson-02-shapes.html");
    expect(hrefByStepId["003-tangent"]).toBe("/ai-course-lab/visuals/lesson-a/003-tangent.html");
    expect(refs.map((ref) => ref.outRelPath).sort()).toEqual([
      "visuals/course/lesson-02-shapes.html",
      "visuals/lesson-a/003-tangent.html",
    ]);
  });

  it("skips a visual that is declared but not on disk", () => {
    // Рамка, смонтированная на отсутствующий файл, — пустой прямоугольник
    // посреди урока.
    const { refs, hrefByStepId } = collect([
      { id: "004-missing", type: "visual", title: "Нет файла", visual_brief: "что-нибудь" },
    ]);

    expect(refs).toEqual([]);
    expect(hrefByStepId).toEqual({});
  });

  it("rejects a path that climbs out of learning-visuals", () => {
    fs.writeFileSync(path.join(sourceDir, "secret.html"), "<html></html>");

    const { refs } = collect([
      { id: "005-evil", type: "visual", title: "Побег", visual: "../source/secret.html" },
    ]);

    expect(refs).toEqual([]);
  });
});
