import { describe, expect, it } from "vitest";
import { lessonUrl, stepPageHref, stepPageUrl } from "./anchors";

describe("stepPageUrl", () => {
  it("builds the address of a step page", () => {
    expect(stepPageUrl("/base", "lesson-a", "003-kasatelnaya")).toBe(
      "/base/lesson/lesson-a/003-kasatelnaya/",
    );
  });
});

describe("stepPageHref", () => {
  const href = stepPageHref({
    basePath: "/base",
    slug: "lesson-a",
    stepIds: ["001-problem", "002-proizvodnaya", "003-kasatelnaya"],
    writtenIds: ["001-problem", "003-kasatelnaya"],
  });

  it("maps a human step number onto that step's page", () => {
    expect(href(3)).toBe("/base/lesson/lesson-a/003-kasatelnaya/");
  });

  it("sends a link to an unwritten step back to the lesson", () => {
    // Страницы у ненаписанного шага нет, и ссылка на неё была бы 404
    // посреди чтения.
    expect(href(2)).toBe(lessonUrl("/base", "lesson-a"));
  });

  it("sends a number outside the plan back to the lesson", () => {
    expect(href(99)).toBe("/base/lesson/lesson-a/");
    expect(href(0)).toBe("/base/lesson/lesson-a/");
  });
});
