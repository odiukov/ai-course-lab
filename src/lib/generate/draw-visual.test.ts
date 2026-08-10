import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lessonPaths } from "../content/paths";
import type { StepMeta } from "../content/step-file";
import { drawVisual, stripHtmlFence, validateVisualHtml } from "./draw-visual";

const SLUG = "01-math-foundations__02-beta";
const GOOD_HTML = '<!doctype html><html><body><svg viewBox="0 0 10 10"></svg></body></html>';

const META: StepMeta = {
  id: "004-dlina",
  type: "visual",
  title: "Длина вектора",
  visual_brief: "вектор [3, 4] как стрелка из (0,0)",
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "draw-visual-"));
}

function call(contentDir: string, run: ReturnType<typeof vi.fn>, meta: StepMeta = META) {
  return drawVisual({
    contentDir,
    slug: SLUG,
    meta,
    body: "Тело шага про длину вектора.",
    sourceExcerpt: "### Vectors",
    deps: { run },
  });
}

describe("stripHtmlFence", () => {
  it("снимает ```html вокруг всего ответа", () => {
    expect(stripHtmlFence("```html\n<svg></svg>\n```")).toBe("<svg></svg>");
  });

  it("снимает забор без языка", () => {
    expect(stripHtmlFence("```\n<svg></svg>\n```")).toBe("<svg></svg>");
  });

  it("не трогает голый HTML", () => {
    expect(stripHtmlFence("<svg></svg>")).toBe("<svg></svg>");
  });
});

describe("validateVisualHtml", () => {
  it("пропускает самодостаточный SVG", () => {
    expect(validateVisualHtml(GOOD_HTML)).toBeNull();
  });

  it("отклоняет пустой ответ", () => {
    expect(validateVisualHtml("   \n ")).toMatch(/пустой/);
  });

  it("отклоняет файл без svg", () => {
    expect(validateVisualHtml("<html><body><div>схема</div></body></html>")).toMatch(/svg/i);
  });

  it.each([
    '<svg></svg><script src="https://cdn.example.com/d3.js"></script>',
    "<svg></svg><script src='http://cdn.example.com/d3.js'></script>",
    '<svg></svg><link href="//cdn.example.com/x.css" rel="stylesheet">',
  ])("отклоняет внешний ресурс: %s", (html) => {
    expect(validateVisualHtml(html)).toMatch(/внешн/);
  });
});

describe("drawVisual", () => {
  it("пишет файл рядом с шагами", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue(GOOD_HTML);

    expect(await call(contentDir, run)).toBeNull();
    expect(fs.readFileSync(lessonPaths(contentDir, SLUG).visualFile("004-dlina"), "utf8")).toContain("<svg");
  });

  it("кладёт бриф и тело шага в промпт", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue(GOOD_HTML);
    await call(contentDir, run);

    const prompt = run.mock.calls[0][0] as string;
    expect(prompt).toContain("вектор [3, 4] как стрелка из (0,0)");
    expect(prompt).toContain("Тело шага про длину вектора.");
  });

  it("не пишет файл, когда ответ не прошёл проверку", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("<html><body>нет схемы</body></html>");

    expect(await call(contentDir, run)).toMatch(/svg/i);
    expect(fs.existsSync(lessonPaths(contentDir, SLUG).visualFile("004-dlina"))).toBe(false);
  });

  it("не зовёт агента, когда файл уже есть", async () => {
    const contentDir = tmpDir();
    const file = lessonPaths(contentDir, SLUG).visualFile("004-dlina");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, GOOD_HTML);

    const run = vi.fn().mockResolvedValue(GOOD_HTML);
    expect(await call(contentDir, run)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("не зовёт агента для шага без брифа", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue(GOOD_HTML);

    const meta: StepMeta = { id: "005-v", type: "visual", title: "Готовая схема", visual: "learning-visuals/x.html" };
    expect(await call(contentDir, run, meta)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
