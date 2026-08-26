import { describe, expect, it } from "vitest";
import type { Step, StepMeta } from "../content/step-file";
import { buildLessonModel } from "./lesson-page";
import {
  renderAuthPage,
  renderIndexPage,
  renderLessonIndexPage,
  renderStepPage,
} from "./render";

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
  it("marks only the step content for Pagefind and exposes result metadata", () => {
    const html = renderStepPage(model(allWritten), 1, { basePath: "/base" });

    expect(html).toContain('<article class="step" data-pagefind-body>');
    expect(html).toContain('<h1 class="step-title" data-pagefind-meta="title">Проверка</h1>');
    expect(html).toContain('data-pagefind-meta="lesson">← Урок</a>');
    expect(html).toContain('<header class="step-header" data-pagefind-ignore>');
    expect(html).toContain('<div class="toc-drawer" data-pagefind-ignore>');
    expect(html).toContain('<nav class="step-nav" data-pagefind-ignore>');
  });

  it("excludes step controls from Pagefind", () => {
    const html = renderStepPage(model(allWritten), 1, { basePath: "/base" });

    expect(html).toContain('<div class="progress" data-pagefind-ignore>');
    expect(html).toContain(
      '<button type="button" class="return-button" data-return data-pagefind-ignore hidden>',
    );
  });

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
    expect(html).toContain('<div class="quiz" data-quiz data-pagefind-ignore>');
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
    expect(html).toContain("data-console-panel");
    expect(html).toContain("data-console");
    expect(html).toContain('"fn":"magnitude"');
    expect(html).toContain('"functions":["magnitude","dot"]');
    expect(html).toContain("/base/assets/pyodide/");
    expect(html).toContain('<section class="practice-panel" data-pagefind-ignore>');
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
  it("excludes the lesson table of contents from Pagefind", () => {
    const html = renderLessonIndexPage(model(allWritten), { basePath: "/base" });

    expect(html).toContain('<body data-base="/base" data-pagefind-ignore="all">');
    expect(html).not.toContain("data-pagefind-body");
  });

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
  it("excludes the catalog from step search results", () => {
    const html = renderIndexPage([], { basePath: "/base" });

    expect(html).toContain('<body data-base="/base" data-pagefind-ignore="all">');
    expect(html).not.toContain("data-pagefind-body");
  });

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

  it("на главной есть ссылка на повторения со счётчиком", () => {
    const html = renderIndexPage([], { basePath: "/base" });
    expect(html).toContain('href="/base/review/"');
    expect(html).toContain("data-review-due");
  });
});

/**
 * Общая обвязка страницы.
 *
 * Базовый путь в атрибуте `body` читают две стороны: бандл входа берёт из него
 * адрес возврата OAuth, а скрипт страницы `/auth/` — границу, за которую
 * переход не выпускается. Обе молча сломаются, если атрибут пропадёт.
 */
describe("обвязка страницы", () => {
  it("добавляет поиск и его бандл на все статические страницы", () => {
    const pages = [
      renderStepPage(model(allWritten), 1, { basePath: "/base" }),
      renderLessonIndexPage(model(allWritten), { basePath: "/base" }),
      renderIndexPage([], { basePath: "/base" }),
      renderAuthPage({ basePath: "/base" }),
    ];

    for (const html of pages) {
      expect(html).toContain("data-search-trigger");
      expect(html).toContain("data-header-actions");
      expect(html).toContain('<script src="/base/assets/search.js"></script>');
    }
  });

  it("грузит поиск перед auth, но после него не оставляет инлайновые скрипты", () => {
    const html = renderStepPage(model(allWritten), 1, { basePath: "/base", withAuth: true });
    const search = html.indexOf('<script src="/base/assets/search.js"></script>');
    const auth = html.indexOf('<script src="/base/assets/auth.js"></script>');
    const inline = html.indexOf("<script>");

    expect(search).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(search);
    expect(inline).toBeGreaterThan(auth);
  });

  it("кладёт базовый путь в атрибут body", () => {
    expect(renderStepPage(model(allWritten), 1, { basePath: "/base" })).toContain(
      '<body data-base="/base">',
    );
    expect(renderIndexPage([], { basePath: "/base" })).toContain(
      '<body data-base="/base" data-pagefind-ignore="all">',
    );
    expect(renderIndexPage([], { basePath: "" })).toContain(
      '<body data-base="" data-pagefind-ignore="all">',
    );
  });

  it("подключает бандл входа только тогда, когда он собран", () => {
    // Без переменных сборки файла assets/auth.js нет вовсе, и страница,
    // сославшаяся на него, ловила бы 404 на каждом открытии.
    const withAuth = renderStepPage(model(allWritten), 1, { basePath: "/base", withAuth: true });
    expect(withAuth).toContain('<script src="/base/assets/auth.js"></script>');

    expect(renderStepPage(model(allWritten), 1, { basePath: "/base" })).not.toContain(
      "assets/auth.js",
    );
  });

  it("исключает страницу входа из результатов Pagefind", () => {
    expect(renderAuthPage({ basePath: "/base" })).toContain(
      '<body data-base="/base" data-pagefind-ignore="all">',
    );
  });
});
