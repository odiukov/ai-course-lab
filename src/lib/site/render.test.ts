import { describe, expect, it } from "vitest";
import type { Step, StepMeta } from "../content/step-file";
import { buildLessonModel } from "./lesson-page";
import { renderIndexPage, renderLessonPage } from "./render";

const plan: StepMeta[] = [
  { id: "001-a", type: "theory", title: "Первый" },
  { id: "002-b", type: "check", title: "Проверка" },
];

function model(written: Record<string, Step>, visuals: Record<string, string> = {}) {
  return buildLessonModel({
    slug: "lesson-a",
    title: "Урок",
    steps: plan,
    written,
    visualHrefByStepId: visuals,
  });
}

describe("renderLessonPage", () => {
  it("renders a step body with an anchor and turns step references into anchors", () => {
    const html = renderLessonPage(
      model({
        "001-a": { ...plan[0], body: "" } as Step,
        "002-b": { ...plan[1], body: "Как в шаге 1.", check: [] } as Step,
      }),
      { basePath: "/base" },
    );

    expect(html).toContain('id="step-002-b"');
    expect(html).toContain('href="#step-001-a"');
  });

  it("embeds the answers of a check step as JSON", () => {
    const html = renderLessonPage(
      model({
        "002-b": {
          ...plan[1],
          body: "",
          check: [{ question: "Сколько?", options: ["1", "2"], correct: 1, explanation: "Два." }],
        } as Step,
      }),
      { basePath: "/base" },
    );

    expect(html).toContain('type="application/json"');
    expect(html).toContain('"correct":1');
  });

  it("mounts a lazy sandboxed frame for a visual", () => {
    const html = renderLessonPage(
      model(
        { "001-a": { ...plan[0], body: "" } as Step },
        { "001-a": "/base/visuals/lesson-a/001-a.html" },
      ),
      { basePath: "/base" },
    );

    expect(html).toContain('src="/base/visuals/lesson-a/001-a.html"');
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain('loading="lazy"');
  });

  it("escapes the lesson title", () => {
    const html = renderLessonPage(
      buildLessonModel({
        slug: "lesson-a",
        title: "Урок <script>alert(1)</script>",
        steps: plan,
        written: {},
        visualHrefByStepId: {},
      }),
      { basePath: "/base" },
    );

    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

describe("renderIndexPage", () => {
  it("lists phases, lessons and how much of each is written", () => {
    const html = renderIndexPage(
      [
        {
          number: 1,
          title: "Math Foundations",
          lessons: [
            {
              slug: "01-math__01-a",
              title: "Первый урок",
              number: 1,
              writtenCount: 8,
              plannedCount: 56,
            },
          ],
        },
      ],
      { basePath: "/base" },
    );

    expect(html).toContain('href="/base/lesson/01-math__01-a/"');
    expect(html).toContain("Первый урок");
    expect(html).toContain("8 из 56");
  });
});
