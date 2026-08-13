// Скрипты страницы — единственная часть сайта, которая работает уже в
// браузере, и проверить её можно только браузером. Здесь страница собирается
// целиком, её скрипты выполняются, и проверяется то же, что видит читатель:
// счётчик, полоска, галочки, запись прогресса.
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import type { Step, StepMeta } from "../content/step-file";
import { PROGRESS_KEY_PREFIX } from "./client";
import { buildLessonModel } from "./lesson-page";
import { renderIndexPage, renderLessonIndexPage, renderStepPage } from "./render";

const plan: StepMeta[] = [
  { id: "001-a", type: "theory", title: "Первый" },
  { id: "002-b", type: "theory", title: "Второй" },
  { id: "003-c", type: "theory", title: "Третий" },
];

const written: Record<string, Step> = Object.fromEntries(
  plan.map((meta) => [meta.id, { ...meta, body: "" } as Step]),
);

const model = buildLessonModel({
  slug: "lesson-a",
  title: "Урок",
  steps: plan,
  written,
  visualHrefByStepId: {},
});

const key = `${PROGRESS_KEY_PREFIX}lesson-a`;

/**
 * Открывает страницу в новом окне и выполняет её скрипты.
 *
 * Окно на каждый вызов своё — как в браузере, где переход на другую страницу
 * уносит с собой и обработчики. С общим окном слушатели прошлой страницы
 * доживали до следующего теста и отмечали прочитанными чужие шаги.
 *
 * Код исполняется через window.eval, а не вставкой тега: happy-dom не
 * запускает скрипты, добавленные в документ после разбора.
 */
function open(html: string, progress: string[] = []): Window {
  const window = new Window({ url: "https://example.test/base/lesson/lesson-a/002-b/" });
  const document = window.document;

  if (progress.length > 0) window.localStorage.setItem(key, JSON.stringify(progress));

  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
  for (const script of [...document.body.querySelectorAll("script")]) {
    if (script.getAttribute("type") === "application/json") continue;
    window.eval(script.textContent ?? "");
  }

  return window;
}

/** Открывает страницу шага `current` так, будто пришли по ссылке из шага `from`. */
function openFrom(html: string, current: string, from: string): Window {
  const window = new Window({ url: `https://example.test/base/lesson/lesson-a/${current}/` });
  Object.defineProperty(window.document, "referrer", {
    value: `https://example.test/base/lesson/lesson-a/${from}/`,
    configurable: true,
  });

  window.document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
  for (const script of [...window.document.body.querySelectorAll("script")]) {
    if (script.getAttribute("type") === "application/json") continue;
    window.eval(script.textContent ?? "");
  }

  return window;
}

/**
 * Элемент страницы как HTMLElement.
 *
 * Дженерик querySelector в happy-dom описан через карту тегов, и параметр
 * типа туда не подставить: приходится приводить руками.
 */
function pick(window: Window, selector: string): HTMLElement {
  return window.document.querySelector(selector) as unknown as HTMLElement;
}

function stored(window: Window): unknown {
  const raw = window.localStorage.getItem(key);
  return raw === null ? null : JSON.parse(raw);
}

describe("страница шага", () => {
  it("показывает позицию и прочитанное при загрузке", () => {
    const window = open(renderStepPage(model, 1, { basePath: "/base" }));

    expect(window.document.querySelector("[data-counter]")?.textContent).toBe(
      "2 / 3 · прочитано 0",
    );
  });

  it("считает шаг прочитанным по клику на «Дальше»", () => {
    const window = open(renderStepPage(model, 1, { basePath: "/base" }));

    pick(window, "[data-mark-read]").click();

    expect(stored(window)).toEqual(["002-b"]);
    expect(window.document.querySelector("[data-counter]")?.textContent).toBe(
      "2 / 3 · прочитано 1",
    );
    expect(window.document.querySelector("[data-progress-fill]")?.getAttribute("style")).toContain(
      "33%",
    );
  });

  it("считает шаг прочитанным при уходе со страницы любым способом", () => {
    // Уйти можно ссылкой из оглавления или из текста — не только «Дальше».
    const window = open(renderStepPage(model, 0, { basePath: "/base" }));

    window.dispatchEvent(new window.Event("pagehide"));

    expect(stored(window)).toEqual(["001-a"]);
  });

  it("предлагает вернуться к шагу, из текста которого пришли", () => {
    const window = openFrom(renderStepPage(model, 1, { basePath: "/base" }), "002-b", "001-a");
    const button = pick(window, "[data-return]");

    // Первый шаг — сосед второго по чтению, возвращаться туда нечем: с него
    // сюда ведёт обычное «Дальше».
    expect(button.hidden).toBe(true);
  });

  it("показывает возврат, если пришли не от соседнего шага", () => {
    const window = openFrom(renderStepPage(model, 0, { basePath: "/base" }), "001-a", "003-c");
    const button = pick(window, "[data-return]");

    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe("← Вернуться к шагу 3");
  });

  it("отмечает прочитанное галочкой в оглавлении", () => {
    const window = open(renderStepPage(model, 1, { basePath: "/base" }), ["001-a"]);

    expect(window.document.querySelector('[data-step="001-a"]')?.className).toContain("is-read");
    expect(window.document.querySelector('[data-step="003-c"]')?.className).not.toContain(
      "is-read",
    );
  });

  it("не считает шаг дважды", () => {
    const window = open(renderStepPage(model, 1, { basePath: "/base" }), ["002-b"]);

    pick(window, "[data-mark-read]").click();

    expect(stored(window)).toEqual(["002-b"]);
  });

  it("отмечает прочитанным и последний шаг — кнопкой «Закончить урок»", () => {
    const window = open(renderStepPage(model, 2, { basePath: "/base" }));

    pick(window, "[data-mark-read]").click();

    expect(stored(window)).toEqual(["003-c"]);
  });
});

describe("практика", () => {
  const exercisePlan: StepMeta[] = [
    { id: "001-code", type: "code", title: "Пишем magnitude", exercise_fn: "magnitude" },
  ];
  const exerciseModel = buildLessonModel({
    slug: "lesson-a",
    title: "Урок",
    steps: exercisePlan,
    written: {
      "001-code": { ...exercisePlan[0], body: "" } as Step,
    },
    visualHrefByStepId: {},
  });
  const panel = {
    slug: "p01-l01-linear-algebra",
    functions: ["magnitude", "dot"],
    urls: {
      template: "/base/exercise/p01-l01-linear-algebra/template.py",
      test: "/base/exercise/p01-l01-linear-algebra/test.py",
      solution: "/base/exercise/p01-l01-linear-algebra/solution.py",
    },
  };
  const template = "def magnitude(v):\n    raise NotImplementedError\n";

  /** Открывает шаг практики, подменив загрузку файлов упражнения. */
  async function openPractice(saved?: string): Promise<Window> {
    const window = new Window({ url: "https://example.test/base/lesson/lesson-a/001-code/" });
    if (saved !== undefined) {
      window.localStorage.setItem(`course-exercise:${panel.slug}`, saved);
    }
    window.fetch = (async () =>
      ({ ok: true, text: async () => template })) as unknown as typeof window.fetch;

    const html = renderStepPage(exerciseModel, 0, { basePath: "/base", exercise: panel });
    window.document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
    for (const script of [...window.document.body.querySelectorAll("script")]) {
      if (script.getAttribute("type") === "application/json") continue;
      window.eval(script.textContent ?? "");
    }

    // Заготовка приезжает через промис — даём ему завершиться.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return window;
  }

  it("кладёт в редактор заготовку упражнения", async () => {
    const window = await openPractice();

    expect((pick(window, "[data-code]") as HTMLTextAreaElement).value).toBe(template);
  });

  it("возвращает написанный раньше код", async () => {
    // Код живёт в браузере: вернулся через неделю — он на месте.
    const window = await openPractice("def magnitude(v):\n    return 1\n");

    expect((pick(window, "[data-code]") as HTMLTextAreaElement).value).toContain("return 1");
  });

  it("сохраняет код при вводе", async () => {
    const window = await openPractice();
    const area = pick(window, "[data-code]") as HTMLTextAreaElement;

    area.value = "def magnitude(v):\n    return 2\n";
    area.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);

    expect(window.localStorage.getItem(`course-exercise:${panel.slug}`)).toContain("return 2");
  });
});

describe("оглавление урока", () => {
  it("считает прочитанное и ведёт «Продолжить» на первый непрочитанный шаг", () => {
    const window = open(renderLessonIndexPage(model, { basePath: "/base" }), ["001-a"]);
    const document = window.document;

    expect(document.querySelector("[data-read-count]")?.textContent).toBe("прочитано 1 из 3");

    const resume = pick(window, "[data-resume]");
    expect(resume.hidden).toBe(false);
    expect(resume.getAttribute("href")).toBe("/base/lesson/lesson-a/002-b/");
    expect(resume.textContent).toBe("Продолжить");
  });

  it("на нетронутом уроке предлагает начать с первого шага", () => {
    const window = open(renderLessonIndexPage(model, { basePath: "/base" }));
    const resume = pick(window, "[data-resume]");

    expect(resume.getAttribute("href")).toBe("/base/lesson/lesson-a/001-a/");
    expect(resume.textContent).toBe("Начать урок");
  });
});

describe("каталог", () => {
  it("показывает прочитанное у тех уроков, где что-то прочитано", () => {
    const window = open(
      renderIndexPage(
        [
          {
            number: 1,
            title: "Фаза",
            lessons: [
              { slug: "lesson-a", title: "Урок", number: 1, writtenCount: 3, plannedCount: 3 },
              { slug: "lesson-b", title: "Другой", number: 2, writtenCount: 3, plannedCount: 3 },
            ],
          },
        ],
        { basePath: "/base" },
      ),
      ["001-a", "002-b"],
    );

    const read = [...window.document.querySelectorAll("[data-read]")] as unknown as HTMLElement[];
    expect(read[0].textContent).toBe("прочитано 2");
    expect(read[1].hidden).toBe(true);
  });
});
