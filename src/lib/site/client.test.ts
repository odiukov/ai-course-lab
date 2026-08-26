// Скрипты страницы — единственная часть сайта, которая работает уже в
// браузере, и проверить её можно только браузером. Здесь страница собирается
// целиком, её скрипты выполняются, и проверяется то же, что видит читатель:
// счётчик, полоска, галочки, запись прогресса.
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import type { Step, StepMeta } from "../content/step-file";
import { PROGRESS_KEY_PREFIX } from "./client";
import { REVIEW_KEY_PREFIX } from "./storage-keys";
import { buildLessonModel } from "./lesson-page";
import {
  renderAuthPage,
  renderIndexPage,
  renderLessonIndexPage,
  renderStepPage,
} from "./render";

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
function open(
  html: string,
  progress: string[] = [],
  storage: Record<string, string> = {},
): Window {
  const window = new Window({ url: "https://example.test/base/lesson/lesson-a/002-b/" });
  const document = window.document;

  if (progress.length > 0) window.localStorage.setItem(key, JSON.stringify(progress));
  for (const [storageKey, value] of Object.entries(storage)) {
    window.localStorage.setItem(storageKey, value);
  }

  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
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

  window.document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
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

  it("перерисовывает прогресс, приехавший из облака после отрисовки", () => {
    // Слияние с облаком асинхронно и заканчивается уже после того, как
    // страница нарисована: без события счётчик до перезагрузки врёт.
    const window = open(renderStepPage(model, 1, { basePath: "/base" }));
    window.localStorage.setItem(key, JSON.stringify(["001-a", "003-c"]));

    window.dispatchEvent(new window.CustomEvent("course-sync-progress"));

    expect(window.document.querySelector("[data-counter]")?.textContent).toBe(
      "2 / 3 · прочитано 2",
    );
    expect(window.document.querySelector('[data-step="003-c"]')?.className).toContain("is-read");
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
  const template = [
    '"""Заголовок упражнения."""',
    "",
    "import math",
    "",
    "",
    "def magnitude(v):",
    "    raise NotImplementedError",
    "",
    "",
    "def dot(a, b):",
    "    raise NotImplementedError",
    "",
  ].join("\n");

  /** Открывает шаг практики, подменив загрузку файлов упражнения. */
  async function openPractice(saved?: string): Promise<Window> {
    const window = new Window({ url: "https://example.test/base/lesson/lesson-a/001-code/" });
    if (saved !== undefined) {
      window.localStorage.setItem(`course-exercise:${panel.slug}`, saved);
    }
    window.fetch = (async () =>
      ({ ok: true, text: async () => template })) as unknown as typeof window.fetch;

    const html = renderStepPage(exerciseModel, 0, { basePath: "/base", exercise: panel });
    window.document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
    for (const script of [...window.document.body.querySelectorAll("script")]) {
      if (script.getAttribute("type") === "application/json") continue;
      window.eval(script.textContent ?? "");
    }

    // Заготовка приезжает через промис — даём ему завершиться.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return window;
  }

  it("показывает только функцию шага, а не весь файл", async () => {
    // Заголовок упражнения и чужие функции в редакторе только мешают: писать
    // на этом шаге нужно одну.
    const window = await openPractice();

    const value = (pick(window, "[data-code]") as HTMLTextAreaElement).value;
    expect(value).toBe("def magnitude(v):\n    raise NotImplementedError");
    expect(value).not.toContain("Заголовок упражнения");
    expect(value).not.toContain("def dot");
  });

  it("показывает только квалифицированный метод, а не весь класс и файл", async () => {
    const methodStep: StepMeta = {
      id: "001-method",
      type: "code",
      title: "Budget.exceeded",
      exercise_fn: "Budget.exceeded",
      exercise_file: "main.py",
    };
    const methodModel = buildLessonModel({
      slug: "lesson-method",
      title: "Методы",
      steps: [methodStep],
      written: { "001-method": { ...methodStep, body: "" } as Step },
      visualHrefByStepId: {},
    });
    const methodPanel = {
      slug: "p19-l20-loop",
      multi: true,
      functions: ["Budget.exceeded", "Budget.future"],
      targets: [{
        file: "main.py",
        fn: "Budget.exceeded",
        tests: ["test_steps.py::TestBudget::test_exceeded"],
      }],
      urls: {
        template: "/base/exercise/p19-l20-loop/template/main.py",
        test: "/base/exercise/p19-l20-loop/test.py",
        solution: "/base/exercise/p19-l20-loop/solution/main.py",
        files: [{
          name: "main.py",
          template: "/base/exercise/p19-l20-loop/template/main.py",
          solution: "/base/exercise/p19-l20-loop/solution/main.py",
        }],
        tests: [{ name: "test_steps.py", url: "/base/exercise/p19-l20-loop/tests/test_steps.py" }],
      },
    };
    const source = [
      "import time",
      "",
      "class Budget:",
      "    max_turns: int = 8",
      "    def untouched(self):",
      "        return 1",
      "",
      "    def exceeded(self):",
      "        raise NotImplementedError",
      "",
      "    def future(self):",
      "        raise NotImplementedError",
      "",
      "@dataclass",
      "class HarnessLoop:",
      "    pass",
      "",
    ].join("\n");
    const window = new Window({ url: "https://example.test/base/lesson/lesson-method/001-method/" });
    window.fetch = (async () =>
      ({ ok: true, text: async () => source })) as unknown as typeof window.fetch;
    const html = renderStepPage(methodModel, 0, { basePath: "/base", exercise: methodPanel });
    window.document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
    for (const script of [...window.document.body.querySelectorAll("script")]) {
      if (script.getAttribute("type") === "application/json") continue;
      window.eval(script.textContent ?? "");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    const value = (pick(window, "[data-code]") as HTMLTextAreaElement).value;
    expect(value).toBe("    def exceeded(self):\n        raise NotImplementedError");
    expect(value).not.toContain("class Budget");
    expect(value).not.toContain("untouched");
    expect(pick(window, "[data-context-panel]").hidden).toBe(false);
    expect(pick(window, "[data-context]").textContent).toContain("class Budget:");
    expect(pick(window, "[data-context]").textContent).toContain("max_turns: int = 8");
    expect(pick(window, "[data-context]").textContent).toContain("def untouched(self):");
    expect(pick(window, "[data-context]").textContent).not.toContain("def exceeded(self):");
    expect(pick(window, "[data-context]").textContent).not.toContain("raise NotImplementedError");
    expect(pick(window, "[data-context]").textContent).not.toContain("def future(self):");
    expect(pick(window, "[data-context]").textContent).not.toContain("@dataclass");
  });

  it("забирает в блок функции обломок без отступа", async () => {
    // Строка, случайно оставшаяся у левого края, ломала файл навсегда: она
    // считалась началом следующей функции, оставалась снаружи блока и
    // переживала любую правку — при том, что в редакторе её не видно.
    const broken = template.replace(
      "def magnitude(v):\n    raise NotImplementedError",
      "def magnitude(v):\n    return math.sqrt(sum(x * x\nfor x in v))",
    );
    const window = await openPractice(broken);
    const area = pick(window, "[data-code]") as HTMLTextAreaElement;

    expect(area.value).toContain("for x in v))");

    area.value = "def magnitude(v):\n    return 3";
    area.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);

    const saved = window.localStorage.getItem(`course-exercise:${panel.slug}`)!;
    expect(saved).not.toContain("for x in v))");
    expect(saved).toContain("def dot(a, b):");
  });

  it("возвращает написанный раньше код", async () => {
    // Код живёт в браузере: вернулся через неделю — он на месте.
    const window = await openPractice(template.replace("raise NotImplementedError", "return 1"));

    expect((pick(window, "[data-code]") as HTMLTextAreaElement).value).toContain("return 1");
  });

  it("сохраняет весь файл, подставив в него написанную функцию", async () => {
    // Тесты импортируют из файла все имена сразу, поэтому на диск обязан
    // уехать файл целиком, а не одна функция.
    const window = await openPractice();
    const area = pick(window, "[data-code]") as HTMLTextAreaElement;

    area.value = "def magnitude(v):\n    return 2";
    area.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);

    const saved = window.localStorage.getItem(`course-exercise:${panel.slug}`)!;
    expect(saved).toContain("return 2");
    expect(saved).toContain("def dot(a, b):");
    expect(saved).toContain("import math");
    expect(saved).not.toContain("def magnitude(v):\n    raise NotImplementedError");
  });

  it("показывает print из Python в консоли после прогона", async () => {
    const window = await openPractice();

    Object.defineProperty(window.document.head, "appendChild", {
      configurable: true,
      value(node: Node) {
        const script = node as unknown as HTMLScriptElement;
        if (typeof script.onload === "function") {
          queueMicrotask(() => script.onload?.(new window.Event("load") as unknown as Event));
        }
        return node;
      },
    });

    Object.assign(window, {
      loadPyodide: async () => ({
        FS: { mkdirTree() {}, writeFile() {} },
        globals: { set() {} },
        runPython(source: string) {
          if (source !== "run_json(PAYLOAD)") return undefined;
          return JSON.stringify({
            loadError: null,
            results: [{ name: "test_magnitude", passed: true, message: "" }],
            filtered: true,
            output: "magnitude([3, 4]) = 5\n",
          });
        },
      }),
    });

    pick(window, "[data-run]").click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect({
      hidden: pick(window, "[data-console-panel]").hidden,
      status: pick(window, "[data-run-status]").textContent,
    }).toEqual({ hidden: false, status: "1 из 1 зелёные" });
    expect(pick(window, "[data-console]").textContent).toBe("magnitude([3, 4]) = 5\n");
  });

  it("не теряет исправление после временного переименования функции", async () => {
    // Первый input раньше удалял из hidden full каноническое имя. Второй уже
    // не мог найти место для замены: редактор показывал исправление, а Python
    // продолжал получать вариант с опечаткой.
    const window = await openPractice();
    const area = pick(window, "[data-code]") as HTMLTextAreaElement;

    area.value = "def magnitudee(v):\n    return 1";
    area.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);

    area.value = "def magnitude(v):\n    return 2";
    area.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);

    const saved = window.localStorage.getItem(`course-exercise:${panel.slug}`)!;
    expect(saved).toContain("def magnitude(v):\n    return 2");
    expect(saved).not.toContain("def magnitudee");
    expect(saved).toContain("def dot(a, b):");
  });

  it("восстанавливает имя из сохранённого файла, не стирая прошлые функции", async () => {
    const broken = template
      .replace(
        "def magnitude(v):\n    raise NotImplementedError",
        "def mag_nitude(v):\n    return 41",
      )
      .replace("def dot(a, b):\n    raise NotImplementedError", "def dot(a, b):\n    return 99");

    const window = await openPractice(broken);
    const area = pick(window, "[data-code]") as HTMLTextAreaElement;
    const saved = window.localStorage.getItem(`course-exercise:${panel.slug}`)!;

    expect(area.value).toBe("def magnitude(v):\n    return 41");
    expect(saved).toContain("def magnitude(v):\n    return 41");
    expect(saved).toContain("def dot(a, b):\n    return 99");
    expect(saved).not.toContain("def mag_nitude");
    expect(window.localStorage.getItem(`course-exercise:${panel.slug}:recovery`)).toBe(broken);
  });

  /** Событие о файле, приехавшем из аккаунта после отрисовки страницы. */
  function sendFile(window: Window, detail: Record<string, unknown>): void {
    window.dispatchEvent(
      new window.CustomEvent("course-sync-file", {
        detail: { slug: panel.slug, fileName: "exercise.py", backup: false, ...detail },
      }),
    );
  }

  it("показывает код, приехавший из аккаунта, в нетронутом редакторе", async () => {
    const window = await openPractice();

    sendFile(window, { content: template.replace("raise NotImplementedError", "return 5") });

    expect((pick(window, "[data-code]") as HTMLTextAreaElement).value).toBe(
      "def magnitude(v):\n    return 5",
    );
    expect(pick(window, "[data-sync-notice]").hidden).toBe(false);
  });

  it("не подменяет код под пальцами: тронутый редактор получает плашку", async () => {
    const window = await openPractice();
    const area = pick(window, "[data-code]") as HTMLTextAreaElement;

    area.value = "def magnitude(v):\n    return 1";
    area.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);

    sendFile(window, { content: template.replace("raise NotImplementedError", "return 5") });

    expect(area.value).toBe("def magnitude(v):\n    return 1");
    expect(pick(window, "[data-sync-notice]").textContent).toContain("Обнови страницу");
  });

  it("сообщает об отложенной копии, а не подменяет текст", async () => {
    // У события про копию содержимого нет вовсе: облачный текст приехал
    // отдельным событием, а это — только объяснение, куда делся локальный.
    const window = await openPractice();
    const area = pick(window, "[data-code]") as HTMLTextAreaElement;
    const before = area.value;

    sendFile(window, { backup: true });

    expect(area.value).toBe(before);
    expect(pick(window, "[data-sync-notice]").textContent).toContain("local-копия");
  });

  it("не реагирует на файл чужого упражнения", async () => {
    const window = await openPractice();
    const area = pick(window, "[data-code]") as HTMLTextAreaElement;
    const before = area.value;

    sendFile(window, { slug: "p01-l02-other", content: "def magnitude(v):\n    return 5" });
    sendFile(window, { fileName: "main.py", content: "def magnitude(v):\n    return 5" });

    expect(area.value).toBe(before);
    expect(pick(window, "[data-sync-notice]").hidden).toBe(true);
  });

  it("не открывает файл, в котором функции шага нет, и не теряет правки после него", async () => {
    // Такой файл попал бы в редактор целиком, save() не нашёл бы в нём места
    // для правки — и каждое нажатие клавиши уходило бы в никуда.
    const window = await openPractice();
    const area = pick(window, "[data-code]") as HTMLTextAreaElement;
    const before = area.value;

    sendFile(window, { content: template.replace("def magnitude(v):", "def magnitudee(v):") });

    expect(area.value).toBe(before);
    expect(pick(window, "[data-sync-notice]").textContent).toContain("Обнови страницу");

    area.value = "def magnitude(v):\n    return 7";
    area.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);

    expect(window.localStorage.getItem(`course-exercise:${panel.slug}`)).toContain("return 7");
  });

  it("оставляет тронутому редактору действенную подсказку, а не плашку про копию", async () => {
    // Про отложенную копию человеку сообщать нечего: на экране его код, и
    // единственное, что ему сейчас нужно, — знать, что в аккаунте лежит другой.
    const window = await openPractice();
    const area = pick(window, "[data-code]") as HTMLTextAreaElement;

    area.value = "def magnitude(v):\n    return 1";
    area.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);

    sendFile(window, { content: template.replace("raise NotImplementedError", "return 5") });
    sendFile(window, { backup: true });

    expect(area.value).toBe("def magnitude(v):\n    return 1");
    expect(pick(window, "[data-sync-notice]").textContent).toContain("Обнови страницу");
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

  it("перерисовывает оглавление по приехавшему из облака прогрессу", () => {
    const window = open(renderLessonIndexPage(model, { basePath: "/base" }));
    window.localStorage.setItem(key, JSON.stringify(["001-a"]));

    window.dispatchEvent(new window.CustomEvent("course-sync-progress"));

    expect(window.document.querySelector("[data-read-count]")?.textContent).toBe(
      "прочитано 1 из 3",
    );
    expect(window.document.querySelector('[data-step="001-a"]')?.className).toContain("is-read");
    expect(pick(window, "[data-resume]").getAttribute("href")).toBe(
      "/base/lesson/lesson-a/002-b/",
    );
  });
});

describe("каталог", () => {
  const phases = [
    {
      number: 1,
      title: "Фаза",
      lessons: [
        { slug: "lesson-a", title: "Урок", number: 1, writtenCount: 3, plannedCount: 3 },
        { slug: "lesson-b", title: "Другой", number: 2, writtenCount: 3, plannedCount: 3 },
      ],
    },
  ];

  /** Строки «прочитано N» в порядке уроков каталога. */
  function counts(window: Window): HTMLElement[] {
    return [...window.document.querySelectorAll("[data-read]")] as unknown as HTMLElement[];
  }

  it("показывает прочитанное у тех уроков, где что-то прочитано", () => {
    const window = open(renderIndexPage(phases, { basePath: "/base" }), ["001-a", "002-b"]);

    const read = counts(window);
    expect(read[0].textContent).toBe("прочитано 2");
    expect(read[1].hidden).toBe(true);
  });

  it("перерисовывает каталог по приехавшему из облака прогрессу", () => {
    // Каталог — первая страница, на которую возвращаются: прогресс со второго
    // устройства должен проступить на ней без перезагрузки.
    const window = open(renderIndexPage(phases, { basePath: "/base" }), ["001-a"]);
    window.localStorage.setItem(key, JSON.stringify(["001-a", "002-b", "003-c"]));
    window.localStorage.setItem(
      `${PROGRESS_KEY_PREFIX}lesson-b`,
      JSON.stringify(["001-a"]),
    );

    window.dispatchEvent(new window.CustomEvent("course-sync-progress"));

    const read = counts(window);
    expect(read[0].textContent).toBe("прочитано 3");
    expect(read[1].textContent).toBe("прочитано 1");
    expect(read[1].hidden).toBe(false);
  });

  it("прячет бейдж повторений, когда готовых карточек нет", () => {
    const window = open(renderIndexPage(phases, { basePath: "/base" }));

    const badge = pick(window, "[data-review-due]");
    expect(badge.hidden).toBe(true);
  });

  it("считает в бейдже карточки всех уроков, чей срок уже наступил", () => {
    // Даты нарочно далеко в прошлом и в будущем: тест проверяет отбор по
    // dueOn, а не то, что считает сегодняшним днём сам скрипт.
    const window = open(renderIndexPage(phases, { basePath: "/base" }), [], {
      [`${REVIEW_KEY_PREFIX}lesson-a`]: JSON.stringify({
        "card-1": { dueOn: "2000-01-01" },
        "card-2": { dueOn: "2999-01-01" },
      }),
      [`${REVIEW_KEY_PREFIX}lesson-b`]: JSON.stringify({
        "card-3": { dueOn: "2000-06-01" },
      }),
    });

    const badge = pick(window, "[data-review-due]");
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("2");
  });

  it("не гасит бейдж из-за битого значения под одним уроком", () => {
    // Один урок хранит неразбираемый мусор — например, обрезанную запись
    // после отказа квоты; у другого урока карточка честно готова к
    // повторению. Битый ключ не должен утопить хороший.
    const window = open(renderIndexPage(phases, { basePath: "/base" }), [], {
      [`${REVIEW_KEY_PREFIX}lesson-a`]: "{not valid json",
      [`${REVIEW_KEY_PREFIX}lesson-b`]: JSON.stringify({
        "card-1": { dueOn: "2000-01-01" },
      }),
    });

    const badge = pick(window, "[data-review-due]");
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("1");
  });
});

describe("состояние шага", () => {
  const stateKey = "course-step-state:lesson-a";

  it("отмечает шаг сданным, когда все вопросы отвечены верно", () => {
    const withQuiz = buildLessonModel({
      slug: "lesson-a",
      title: "Урок",
      steps: plan,
      written: {
        ...written,
        "002-b": {
          ...written["002-b"],
          check: [
            { question: "Раз?", options: ["Да", "Нет"], correct: 0 },
            { question: "Два?", options: ["Да", "Нет"], correct: 1 },
          ],
        } as Step,
      },
      visualHrefByStepId: {},
    });

    const html = renderStepPage(withQuiz, 1, { basePath: "/base", nextLesson: null });
    const window = open(html);

    const questions = [...window.document.querySelectorAll("[data-question]")];
    (questions[0].querySelectorAll("[data-option]")[0] as unknown as HTMLElement).click();
    expect(JSON.parse(window.localStorage.getItem(stateKey) ?? "{}")["002-b"]).toBeUndefined();

    (questions[1].querySelectorAll("[data-option]")[1] as unknown as HTMLElement).click();
    const entry = JSON.parse(window.localStorage.getItem(stateKey) ?? "{}")["002-b"];
    expect(entry.state).toBe("passed");
    // Время изменения пишется рядом с состоянием: без него слияние с облаком
    // подставляло бы время открытия страницы и выигрывало бы каждую ничью.
    expect(Number.isNaN(Date.parse(entry.updatedAt))).toBe(false);
  });

  it("отмечает шаг проваленным на неверном ответе", () => {
    const withQuiz = buildLessonModel({
      slug: "lesson-a",
      title: "Урок",
      steps: plan,
      written: {
        ...written,
        "002-b": {
          ...written["002-b"],
          check: [{ question: "Раз?", options: ["Да", "Нет"], correct: 0 }],
        } as Step,
      },
      visualHrefByStepId: {},
    });

    const html = renderStepPage(withQuiz, 1, { basePath: "/base", nextLesson: null });
    const window = open(html);

    const wrong = window.document.querySelectorAll("[data-option]")[1] as unknown as HTMLElement;
    wrong.click();
    expect(JSON.parse(window.localStorage.getItem(stateKey) ?? "{}")["002-b"].state).toBe("failed");
  });

  it("не сбрасывает сданный шаг последующим неверным ответом", () => {
    const withQuiz = buildLessonModel({
      slug: "lesson-a",
      title: "Урок",
      steps: plan,
      written: {
        ...written,
        "002-b": {
          ...written["002-b"],
          check: [{ question: "Раз?", options: ["Да", "Нет"], correct: 0 }],
        } as Step,
      },
      visualHrefByStepId: {},
    });

    const html = renderStepPage(withQuiz, 1, { basePath: "/base", nextLesson: null });
    const window = open(html);
    // Голая строка вместо записи — форма ключа первых дней: она могла остаться
    // в браузере разработчика, и понижать сданный шаг из-за неё нельзя.
    window.localStorage.setItem(stateKey, JSON.stringify({ "002-b": "passed" }));

    const wrong = window.document.querySelectorAll("[data-option]")[1] as unknown as HTMLElement;
    wrong.click();
    expect(JSON.parse(window.localStorage.getItem(stateKey) ?? "{}")["002-b"]).toBe("passed");
  });

  it("не считает шаг сданным, если верный ответ пережил переклик неверным на другом вопросе", () => {
    const withQuiz = buildLessonModel({
      slug: "lesson-a",
      title: "Урок",
      steps: plan,
      written: {
        ...written,
        "002-b": {
          ...written["002-b"],
          check: [
            { question: "Раз?", options: ["Да", "Нет"], correct: 0 },
            { question: "Два?", options: ["Да", "Нет"], correct: 1 },
          ],
        } as Step,
      },
      visualHrefByStepId: {},
    });

    const html = renderStepPage(withQuiz, 1, { basePath: "/base", nextLesson: null });
    const window = open(html);

    const questions = [...window.document.querySelectorAll("[data-question]")];
    // Q1: сначала верно, затем переклик неверным вариантом.
    (questions[0].querySelectorAll("[data-option]")[0] as unknown as HTMLElement).click();
    (questions[0].querySelectorAll("[data-option]")[1] as unknown as HTMLElement).click();
    // Q2: верно — но Q1 сейчас показывает неверный вариант, шаг не сдан.
    (questions[1].querySelectorAll("[data-option]")[1] as unknown as HTMLElement).click();

    expect(JSON.parse(window.localStorage.getItem(stateKey) ?? "{}")["002-b"]).not.toBe("passed");
  });
});

/**
 * Страница возврата после входа.
 *
 * Адрес возврата — единственное место на сайте, где путь перехода приходит
 * снаружи: его подставляет тот, кто прислал ссылку. Поэтому проверяется в
 * первую очередь то, что уйти по ней можно только внутрь самого сайта.
 */
describe("AUTH_PAGE_SCRIPT", () => {
  /**
   * Открывает `/auth/?next=...` и отдаёт то, что скрипт сделал по итогу входа.
   *
   * `ahead` — бандл входа успел закончить работу до того, как скрипт страницы
   * подписался: итог лежит в window.CourseSyncReady, а событие уже пролетело.
   */
  function openAuth(
    next: string | null,
    detail: Record<string, unknown>,
    basePath = "/base",
    ahead = false,
  ) {
    const search = next === null ? "" : `?next=${encodeURIComponent(next)}`;
    const window = new Window({ url: `https://example.test${basePath}/auth/${search}` });
    const html = renderAuthPage({ basePath });

    window.document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
    window.document.body.setAttribute("data-base", basePath);

    // Переход выполняется отложенно; ждать секунду в тесте незачем, поэтому
    // таймер срабатывает сразу, а сам переход только записывается.
    const replaced: string[] = [];
    Object.defineProperty(window, "setTimeout", {
      value: (fn: () => void) => {
        fn();
        return 0;
      },
      configurable: true,
    });
    Object.defineProperty(window.location, "replace", {
      value: (url: string) => replaced.push(url),
      configurable: true,
    });

    if (ahead) (window as unknown as { CourseSyncReady?: unknown }).CourseSyncReady = detail;

    for (const script of [...window.document.body.querySelectorAll("script")]) {
      if (script.getAttribute("type") === "application/json") continue;
      window.eval(script.textContent ?? "");
    }
    if (!ahead) window.dispatchEvent(new window.CustomEvent("course-sync-ready", { detail }));

    return {
      replaced,
      status: window.document.querySelector("[data-auth-status]")?.textContent ?? "",
    };
  }

  const signedIn = { user: "u-1", migrated: false };

  it("забирает итог, когда бандл входа закончил раньше подписки на событие", () => {
    // Бандл грузится блокирующим тегом и в принципе может закончить работу до
    // того, как этот скрипт вообще выполнится. Раньше страница в таком случае
    // навсегда осталась бы на «Проверяю вход…».
    const page = openAuth("/base/lesson/lesson-a/002-b/", signedIn, "/base", true);
    expect(page.status).toBe("Вход выполнен.");
    expect(page.replaced).toEqual(["/base/lesson/lesson-a/002-b/"]);
  });

  it("returns to the page the reader came from", () => {
    expect(openAuth("/base/lesson/lesson-a/002-b/", signedIn).replaced).toEqual([
      "/base/lesson/lesson-a/002-b/",
    ]);
  });

  it("falls back to the course root without a next", () => {
    expect(openAuth(null, signedIn).replaced).toEqual(["/base/"]);
  });

  // Чужой адрес целиком, адрес без схемы, обратная косая, которую браузер
  // выпрямит в такой же адрес без схемы, и путь вне базового.
  it.each([["https://evil.test/"], ["//evil.test/"], ["/\\evil.test/"], ["/other/page/"]])(
    "refuses to redirect off the site: %s",
    (next) => {
      expect(openAuth(next, signedIn).replaced).toEqual(["/base/"]);
    },
  );

  // На своём домене базового пути нет, и проверка «внутри базового» ничего не
  // ловит — остаётся одна сверка адреса с адресом самой страницы. Здесь всё,
  // что выглядит путём, но разбирается в чужой сайт: обратная косая, которую
  // разбор выпрямляет, и табуляция с переводами строк, которые он выбрасывает
  // до разбора, оставляя те же две косые подряд.
  it.each([
    ["//evil.test/"],
    ["/\\evil.test/"],
    ["/\\/evil.test/"],
    ["/\t/evil.test/"],
    ["/\n/evil.test/"],
    ["/\r/evil.test/"],
  ])("refuses to redirect off a site published without a base path: %j", (next) => {
    expect(openAuth(next, signedIn, "").replaced).toEqual(["/"]);
  });

  it("reports the outcome of the first merge", () => {
    const page = openAuth("/base/", {
      user: "u-1",
      migrated: true,
      steps: 12,
      files: 3,
      backups: 1,
    });

    expect(page.status).toContain("шагов 12");
    expect(page.status).toContain("файлов 3");
    expect(page.status).toContain("отложено копий кода 1");
  });

  it("does not pretend the merge succeeded when it failed", () => {
    const page = openAuth("/base/", { user: "u-1", migrated: false, error: "Failed to fetch" });

    expect(page.status).toContain("влить не удалось");
    expect(page.replaced).toEqual(["/base/"]);
  });

  it("stays put and explains when there is no session", () => {
    const page = openAuth("/base/", { user: null });

    expect(page.status).toContain("Войти не удалось");
    expect(page.replaced).toEqual([]);
  });
});
