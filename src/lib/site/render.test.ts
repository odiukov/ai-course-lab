import { describe, expect, it } from "vitest";
import type { Step, StepMeta } from "../content/step-file";
import { buildLessonModel } from "./lesson-page";
import { renderIndexPage, renderLessonIndexPage, renderStepPage } from "./render";

const plan: StepMeta[] = [
  { id: "001-a", type: "theory", title: "Первый" },
  { id: "002-b", type: "check", title: "Проверка" },
  { id: "003-c", type: "theory", title: "Третий" },
];

function step(meta: StepMeta, overrides: Partial<Step> = {}): Step {
  return { ...meta, body: "", ...overrides } as Step;
}

function model(written: Record<string, Step>, visuals: Record<string, string> = {}) {
  return buildLessonModel({
    slug: "lesson-a",
    title: "Урок",
    steps: plan,
    written,
    visualHrefByStepId: visuals,
  });
}

const allWritten = {
  "001-a": step(plan[0]),
  "002-b": step(plan[1], { check: [] }),
  "003-c": step(plan[2]),
};

describe("renderStepPage", () => {
  it("links Back and Next to the neighbouring step pages", () => {
    const html = renderStepPage(model(allWritten), 1, { basePath: "/base" });

    expect(html).toContain('href="/base/lesson/lesson-a/001-a/">Назад');
    expect(html).toContain('href="/base/lesson/lesson-a/003-c/">Дальше');
  });

  it("marks the last step read through the finish button", () => {
    const html = renderStepPage(model(allWritten), 2, { basePath: "/base" });

    // У последнего шага «Дальше» некуда, но прочитанным его отметить надо.
    expect(html).toContain("Закончить урок");
    expect(html).toMatch(/data-mark-read[^>]*href="\/base\/lesson\/lesson-a\/"/);
  });

  it("points the last step at the next lesson", () => {
    const html = renderStepPage(model(allWritten), 2, {
      basePath: "/base",
      nextLesson: { slug: "lesson-b", title: "Следующий" },
    });

    expect(html).toContain('href="/base/lesson/lesson-b/"');
    expect(html).toContain("Следующий урок: Следующий");
  });

  it("does not offer a next lesson in the middle of one", () => {
    const html = renderStepPage(model(allWritten), 1, {
      basePath: "/base",
      nextLesson: { slug: "lesson-b", title: "Следующий" },
    });

    expect(html).not.toContain("Следующий урок");
  });

  it("keeps a hidden slot for the return button", () => {
    // Показывает её скрипт: знает ли он, откуда пришли, решает referrer.
    const html = renderStepPage(model(allWritten), 1, { basePath: "/base" });

    expect(html).toContain("data-return");
    expect(html).toContain("hidden");
  });

  it("carries the lesson position for the progress script", () => {
    const html = renderStepPage(model(allWritten), 1, { basePath: "/base" });

    expect(html).toContain('data-lesson>{"slug":"lesson-a","stepId":"002-b","number":2');
    expect(html).toContain('"plannedCount":3');
    expect(html).toContain("2 / 3");
  });

  it("turns a step reference in the text into a link to that step's page", () => {
    const html = renderStepPage(
      model({ ...allWritten, "003-c": step(plan[2], { body: "Как в шаге 1." }) }),
      2,
      { basePath: "/base" },
    );

    expect(html).toContain('href="/base/lesson/lesson-a/001-a/"');
  });

  it("sends a reference to an unwritten step back to the lesson", () => {
    // Страницы у него нет: ссылка вела бы в 404 посреди чтения.
    const html = renderStepPage(
      model({ "001-a": step(plan[0]), "003-c": step(plan[2], { body: "Как в шаге 2." }) }),
      1,
      { basePath: "/base" },
    );

    expect(html).toContain('<a href="/base/lesson/lesson-a/">2</a>');
  });

  it("embeds the answers of a check step as JSON", () => {
    const html = renderStepPage(
      model({
        ...allWritten,
        "002-b": step(plan[1], {
          check: [{ question: "Сколько?", options: ["1", "2"], correct: 1, explanation: "Два." }],
        }),
      }),
      1,
      { basePath: "/base" },
    );

    expect(html).toContain('type="application/json" data-quiz-answers');
    expect(html).toContain('"correct":1');
  });

  it("mounts a lazy sandboxed frame for a visual", () => {
    const html = renderStepPage(
      model(allWritten, { "001-a": "/base/visuals/lesson-a/001-a.html" }),
      0,
      { basePath: "/base" },
    );

    expect(html).toContain('src="/base/visuals/lesson-a/001-a.html"');
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain('loading="lazy"');
  });

  it("gives a code step an editor, the exercise files and the step's function", () => {
    const codePlan: StepMeta[] = [
      { id: "001-code", type: "code", title: "Практика", exercise_fn: "magnitude" },
    ];
    const html = renderStepPage(
      buildLessonModel({
        slug: "lesson-a",
        title: "Урок",
        steps: codePlan,
        written: { "001-code": step(codePlan[0]) },
        visualHrefByStepId: {},
      }),
      0,
      {
        basePath: "/base",
        exercise: {
          slug: "p01-l01-x",
          functions: ["magnitude", "dot"],
          urls: {
            template: "/base/exercise/p01-l01-x/template.py",
            test: "/base/exercise/p01-l01-x/test.py",
            solution: null,
          },
        },
      },
    );

    expect(html).toContain("data-code");
    expect(html).toContain("data-context-panel");
    expect(html).toContain("data-context");
    expect(html).toContain("data-run");
    expect(html).toContain('"fn":"magnitude"');
    expect(html).toContain('"functions":["magnitude","dot"]');
    expect(html).toContain("/base/assets/pyodide/");
    // Эталона у этого упражнения нет — и кнопки быть не должно.
    expect(html).not.toContain("<button type=\"button\" class=\"nav-button\" data-show-solution>");
  });

  it("says so when the lesson has no exercise", () => {
    const codePlan: StepMeta[] = [
      { id: "001-code", type: "code", title: "Практика", exercise_fn: "magnitude" },
    ];
    const html = renderStepPage(
      buildLessonModel({
        slug: "lesson-a",
        title: "Урок",
        steps: codePlan,
        written: { "001-code": step(codePlan[0]) },
        visualHrefByStepId: {},
      }),
      0,
      { basePath: "/base" },
    );

    expect(html).toContain("Упражнение к этому уроку не выложено");
    expect(html).not.toContain("data-run");
  });

  it("escapes the step title", () => {
    const html = renderStepPage(
      model({ "001-a": step({ ...plan[0], title: "<script>alert(1)</script>" }) }),
      0,
      { basePath: "/base" },
    );

    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

describe("renderLessonIndexPage", () => {
  it("lists every planned step and marks the unwritten ones", () => {
    const html = renderLessonIndexPage(model({ "001-a": step(plan[0]) }), { basePath: "/base" });

    expect(html).toContain('href="/base/lesson/lesson-a/001-a/"');
    expect(html).toContain("ещё не написан");
    expect(html).toContain("готово 1 шагов из 3");
  });

  it("does not offer the next lesson before this one is read", () => {
    // Следующий урок предлагается в конце последнего шага, а не в шапке:
    // на входе в урок такая кнопка зовёт мимо него.
    const html = renderLessonIndexPage(model(allWritten), {
      basePath: "/base",
      nextLesson: { slug: "lesson-b", title: "Следующий" },
    });

    expect(html).not.toContain('href="/base/lesson/lesson-b/"');
  });

  it("offers a resume button the script can point at the first unread step", () => {
    const html = renderLessonIndexPage(model(allWritten), { basePath: "/base" });

    expect(html).toContain("data-resume");
    expect(html).toContain('data-lesson>{"slug":"lesson-a","plannedCount":3}');
  });
});

describe("renderIndexPage", () => {
  it("lists phases and lessons, with a slot the script fills with read counts", () => {
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
    expect(html).toContain('data-lesson-slug="01-math__01-a"');
    expect(html).toContain("data-read");
    expect(html).toContain("8 из 56 шагов");
  });
});
