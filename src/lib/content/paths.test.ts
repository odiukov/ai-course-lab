import { describe, expect, it } from "vitest";
import path from "node:path";
import { lessonPaths, repoRelative } from "./paths";

describe("repoRelative", () => {
  const root = path.resolve("/repo");

  it("делает путь внутри репозитория относительным и с прямыми слешами", () => {
    const abs = path.join(root, "source", "i18n", "ru", "docs", "ru.md");
    expect(repoRelative(abs, root)).toBe("source/i18n/ru/docs/ru.md");
  });

  it("оставляет путь снаружи репозитория абсолютным, а не строит ../../..", () => {
    const outside = path.resolve("/elsewhere/course/docs/en.md");
    expect(repoRelative(outside, root)).toBe(outside);
  });

  it("не превращает сам корень в пустую строку", () => {
    expect(repoRelative(root, root)).toBe(root);
  });
});

describe("lessonPaths", () => {
  it("складывает пути урока от contentDir", () => {
    const paths = lessonPaths(path.resolve("/repo/content"), "01-a__02-b");
    expect(paths.planFile).toBe(path.resolve("/repo/content/lessons/01-a__02-b/lesson.json"));
    expect(paths.stepFile("003-x")).toBe(
      path.resolve("/repo/content/lessons/01-a__02-b/steps/003-x.md"),
    );
    expect(paths.clarificationFile("003-x")).toBe(
      path.resolve("/repo/content/lessons/01-a__02-b/clarifications/003-x.md"),
    );
  });

  it("кладёт сгенерированные схемы в visuals рядом со steps", () => {
    const paths = lessonPaths("/content", "01-math-foundations__02-beta");

    expect(paths.visualsDir).toBe(
      path.join("/content", "lessons", "01-math-foundations__02-beta", "visuals"),
    );
    expect(paths.visualFile("004-dlina")).toBe(path.join(paths.visualsDir, "004-dlina.html"));
  });
});
