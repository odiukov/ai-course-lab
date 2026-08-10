import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveGeneratedVisualPath, resolveVisualPath } from "./visual-path";

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

describe("resolveGeneratedVisualPath", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const SLUG = "01-math-foundations__02-beta";

  function makeTree(): { contentDir: string; visualsDir: string } {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-visual-"));
    const visualsDir = path.join(dir, "lessons", SLUG, "visuals");
    fs.mkdirSync(visualsDir, { recursive: true });
    return { contentDir: dir, visualsDir };
  }

  it("пропускает нарисованный шаг", () => {
    const { contentDir, visualsDir } = makeTree();
    fs.writeFileSync(path.join(visualsDir, "004-dlina.html"), "<svg></svg>");

    const result = resolveGeneratedVisualPath(contentDir, SLUG, "004-dlina");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(fs.realpathSync(path.join(visualsDir, "004-dlina.html")));
    }
  });

  it("404, если шаг ещё не нарисован", () => {
    const { contentDir } = makeTree();

    expect(resolveGeneratedVisualPath(contentDir, SLUG, "004-dlina")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it.each(["../../../etc/passwd", "..", "a/b", "a\\b", "."])(
    "отклоняет id шага %s, не доходя до диска",
    (stepId) => {
      const { contentDir } = makeTree();

      expect(resolveGeneratedVisualPath(contentDir, SLUG, stepId)).toEqual({
        ok: false,
        reason: "forbidden",
      });
    },
  );

  it("отклоняет slug с обходом каталога", () => {
    const { contentDir } = makeTree();

    expect(resolveGeneratedVisualPath(contentDir, "../../etc", "004-dlina")).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("отклоняет симлинк, ведущий за пределы visuals", () => {
    const { contentDir, visualsDir } = makeTree();
    const secret = path.join(contentDir, "secret.txt");
    fs.writeFileSync(secret, "тайна");
    fs.symlinkSync(secret, path.join(visualsDir, "004-dlina.html"));

    expect(resolveGeneratedVisualPath(contentDir, SLUG, "004-dlina")).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("отклоняет симлинк на директорию", () => {
    const { contentDir, visualsDir } = makeTree();
    const subdir = path.join(visualsDir, "subdir");
    fs.mkdirSync(subdir);
    fs.symlinkSync(subdir, path.join(visualsDir, "004-dlina.html"));

    expect(resolveGeneratedVisualPath(contentDir, SLUG, "004-dlina")).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
});
