import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveVisualPath } from "./visual-path";

describe("resolveVisualPath", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function makeTree(): { sourceDir: string; visualsDir: string } {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "visual-path-"));
    const visualsDir = path.join(dir, "learning-visuals");
    fs.mkdirSync(visualsDir);
    return { sourceDir: dir, visualsDir };
  }

  it("пропускает обычный html-файл внутри learning-visuals", () => {
    const { sourceDir, visualsDir } = makeTree();
    fs.writeFileSync(path.join(visualsDir, "ok.html"), "<html></html>");

    const result = resolveVisualPath(sourceDir, "learning-visuals/ok.html");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(fs.realpathSync(path.join(visualsDir, "ok.html")));
  });

  it("отклоняет обход через ../", () => {
    const { sourceDir } = makeTree();
    fs.writeFileSync(path.join(sourceDir, "secret.html"), "тайна");

    const result = resolveVisualPath(sourceDir, "../secret.html");
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("отклоняет соседнюю директорию learning-visuals-evil", () => {
    const { sourceDir } = makeTree();
    const evilDir = path.join(sourceDir, "learning-visuals-evil");
    fs.mkdirSync(evilDir);
    fs.writeFileSync(path.join(evilDir, "x.html"), "тайна");

    const result = resolveVisualPath(sourceDir, "learning-visuals-evil/x.html");
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("404, если файла нет", () => {
    const { sourceDir } = makeTree();

    const result = resolveVisualPath(sourceDir, "learning-visuals/missing.html");
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("отклоняет симлинк внутри learning-visuals, ведущий наружу", () => {
    const { sourceDir, visualsDir } = makeTree();
    const secret = path.join(sourceDir, "secret.txt");
    fs.writeFileSync(secret, "тайна за пределами learning-visuals");
    fs.symlinkSync(secret, path.join(visualsDir, "evil.html"));

    const result = resolveVisualPath(sourceDir, "learning-visuals/evil.html");
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("отклоняет .html-симлинк внутри дерева, ведущий на не-HTML файл", () => {
    const { sourceDir, visualsDir } = makeTree();
    const notHtml = path.join(visualsDir, "data.json");
    fs.writeFileSync(notHtml, "{}");
    fs.symlinkSync(notHtml, path.join(visualsDir, "looks-like.html"));

    const result = resolveVisualPath(sourceDir, "learning-visuals/looks-like.html");
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("отклоняет .html-симлинк внутри дерева, ведущий на директорию", () => {
    const { sourceDir, visualsDir } = makeTree();
    const subdir = path.join(visualsDir, "subdir");
    fs.mkdirSync(subdir);
    fs.symlinkSync(subdir, path.join(visualsDir, "dir-link.html"));

    const result = resolveVisualPath(sourceDir, "learning-visuals/dir-link.html");
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });
});
