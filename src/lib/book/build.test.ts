import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../config";
import {
  availableBookPhases,
  bookFilename,
  buildPhaseBook,
  resolveChromeExecutable,
} from "./build";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(): Config {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "book-test-"));
  roots.push(root);
  const sourceDir = path.join(root, "source");
  const contentDir = path.join(root, "content");
  const lessonSlug = "01-foundations__01-vectors";
  fs.mkdirSync(path.join(sourceDir, "phases/01-foundations/01-vectors/docs"), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "phases/01-foundations/01-vectors/docs/en.md"), "source");
  fs.mkdirSync(path.join(sourceDir, "learning-exercises/p01-l01-vectors"), { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, "learning-exercises/p01-l01-vectors/exercise.template.py"),
    "def answer():\n    pass\n",
  );
  fs.writeFileSync(
    path.join(sourceDir, "learning-exercises/p01-l01-vectors/solution.py"),
    "def answer():\n    return 42\n",
  );
  const lessonDir = path.join(contentDir, "lessons", lessonSlug);
  fs.mkdirSync(path.join(lessonDir, "steps"), { recursive: true });
  fs.writeFileSync(
    path.join(lessonDir, "lesson.json"),
    JSON.stringify({
      slug: lessonSlug,
      title: "Vectors",
      lang: "ru",
      sourcePath: "source.md",
      sourceHash: "hash",
      generatedAt: new Date(0).toISOString(),
      steps: [
        { id: "001-theory", type: "theory", title: "Theory" },
        { id: "002-check", type: "check", title: "Check" },
        { id: "003-code", type: "code", title: "Code", exercise_fn: "answer" },
        { id: "004-recall", type: "recall", title: "Recall", exercise_fn: "answer" },
        { id: "005-quiz", type: "quiz", title: "Quiz" },
      ],
    }),
  );
  for (const [id, type, title] of [
    ["001-theory", "theory", "Theory"],
    ["002-check", "check", "Check"],
    ["003-code", "code", "Code"],
    ["004-recall", "recall", "Recall"],
    ["005-quiz", "quiz", "Quiz"],
  ]) {
    fs.writeFileSync(
      path.join(lessonDir, "steps", `${id}.md`),
      `---\nid: ${id}\ntype: ${type}\ntitle: ${title}\n${type === "code" || type === "recall" ? "exercise_fn: answer\n" : ""}---\n\n${title} body\n`,
    );
  }
  fs.mkdirSync(path.join(lessonDir, "clarifications"));
  fs.writeFileSync(
    path.join(lessonDir, "clarifications/001-theory.md"),
    "<!-- clarification: 2026-01-01 -->\n## Why?\n\nBecause.\n",
  );

  return {
    sourceDir,
    contentDir,
    dataDir: path.join(root, "data"),
    courseRepo: null,
    localCourseRepo: null,
    upstreamDir: path.join(root, ".cache"),
    upstreamRemote: "",
    upstreamBranch: "main",
    agent: "codex",
    python: "python3",
    lspPort: 3001,
  };
}

describe("buildPhaseBook", () => {
  it("keeps theory and finished solutions, but excludes interactive practice", () => {
    const book = buildPhaseBook(fixture(), 1);
    expect(book?.lessons).toHaveLength(1);
    expect(book?.lessons[0].sections.map((section) => section.title)).toEqual(["Theory"]);
    expect(book?.lessons[0].sections[0].clarifications[0].answer).toBe("Because.");
    expect(book?.lessons[0].solutions).toEqual([
      { name: "exercise.py", code: "def answer():\n    return 42" },
    ]);
  });

  it("returns null for an unknown phase", () => {
    expect(buildPhaseBook(fixture(), 99)).toBeNull();
  });

  it("re-reads edited content instead of caching a previous book", () => {
    const config = fixture();
    const step = path.join(
      config.contentDir,
      "lessons/01-foundations__01-vectors/steps/001-theory.md",
    );
    expect(buildPhaseBook(config, 1)?.lessons[0].sections[0].body).toBe("Theory body");
    fs.writeFileSync(
      step,
      "---\nid: 001-theory\ntype: theory\ntitle: Theory\n---\n\nEdited body\n",
    );
    expect(buildPhaseBook(config, 1)?.lessons[0].sections[0].body).toBe("Edited body");
  });
});

describe("book helpers", () => {
  it("uses stable phase filenames", () => {
    expect(bookFilename(8)).toBe("ai-engineering-phase-08.pdf");
    expect(bookFilename(null)).toBe("ai-engineering-complete.pdf");
  });

  it("lists phases that have prepared lessons", () => {
    expect(availableBookPhases(fixture())).toEqual([1]);
  });

  it("honours an explicit Chrome path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-test-"));
    roots.push(root);
    const chrome = path.join(root, "chrome");
    fs.writeFileSync(chrome, "");
    expect(resolveChromeExecutable({ CHROME_PATH: chrome })).toBe(chrome);
  });
});
