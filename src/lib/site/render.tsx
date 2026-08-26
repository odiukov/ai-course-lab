import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StepBody } from "../../components/StepBody";
import { lessonUrl, stepPageHref, stepPageUrl } from "./anchors";
import type { CatalogPhase } from "./catalog";
import {
  AUTH_PAGE_SCRIPT,
  CATALOG_SCRIPT,
  EXERCISE_SCRIPT,
  FRAME_SCRIPT,
  LESSON_INDEX_SCRIPT,
  PROGRESS_SCRIPT,
  QUIZ_SCRIPT,
} from "./client";
import type { ExerciseUrls } from "./exercise";
import type { LessonBlock, LessonModel } from "./lesson-page";
import { encodeQuizPayload } from "./quiz";

/** Имя курса: заголовок вкладки и шапка главной. */
export const SITE_TITLE = "AI Lab";

export interface NextLesson {
  slug: string;
  title: string;
}

export interface ExercisePanelData {
  /** Каталог упражнения, он же ключ хранения кода. */
  slug: string;
  /** Канонический состав упражнения — по нему отбираются тесты шага. */
  functions: string[];
  multi?: boolean;
  targets?: { file: string; fn: string; tests: string[] }[];
  urls: ExerciseUrls;
}

export interface RenderOptions {
  basePath: string;
  /** Следующий урок курса — куда идти, когда этот дочитан. */
  nextLesson?: NextLesson | null;
  /** Упражнение урока, если оно есть. */
  exercise?: ExercisePanelData | null;
  /** Собран ли бандл входа: без переменных сборки страница о нём не знает. */
  withAuth?: boolean;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON внутри тега script: `<` и `&` экранируются, чтобы текст не закрыл тег. */
function encodeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/&/g, "\\u0026");
}

function renderSearchButton(): string {
  return `<button type="button" class="nav-button search-button" data-search-trigger data-pagefind-ignore aria-haspopup="dialog">
<span>Поиск</span>
<kbd class="search-shortcut" data-search-shortcut aria-hidden="true">⌘K</kbd>
</button>`;
}

/**
 * Ссылка на режим повторений.
 *
 * Число готовых карточек на сборке неизвестно — график живёт в браузере
 * читателя, — поэтому счётчик остаётся пустым и скрытым: его проставляет
 * `CATALOG_SCRIPT`.
 */
function renderReviewLink(basePath: string): string {
  return `<a class="nav-button" href="${basePath}/review/">
<span>Повторение</span>
<span data-review-due hidden></span>
</a>`;
}

function htmlDocument(options: {
  title: string;
  basePath: string;
  body: string;
  excludeFromSearch?: boolean;
  scripts?: string[];
  /** Внешние файлы скриптов сайта: грузятся до инлайновых. */
  modules?: string[];
}): string {
  const scripts = [
    `<script src="${options.basePath}/assets/search.js"></script>`,
    ...(options.modules ?? []).map((src) => `<script src="${src}"></script>`),
    ...(options.scripts ?? []).map((code) => `<script>${code}</script>`),
  ].join("\n");
  const pagefind = options.excludeFromSearch ? ' data-pagefind-ignore="all"' : "";

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<link rel="icon" type="image/svg+xml" href="${options.basePath}/assets/favicon.svg">
<link rel="stylesheet" href="${options.basePath}/assets/katex/katex.min.css">
<link rel="stylesheet" href="${options.basePath}/assets/site.css">
</head>
<body data-base="${options.basePath}"${pagefind}>
${options.body}
${scripts}
</body>
</html>
`;
}

/**
 * Бандл входа в списке модулей страницы — или пусто.
 *
 * Он должен загрузиться до инлайновых скриптов: `window.CourseSync` нужен к
 * моменту, когда скрипт страницы впервые до него дотянется.
 */
function authModules(options: RenderOptions): string[] {
  return options.withAuth ? [`${options.basePath}/assets/auth.js`] : [];
}

function renderQuiz(block: LessonBlock): string {
  if (block.questions.length === 0) return "";

  const questions = block.questions
    .map((question, index) => {
      const options = question.options
        .map(
          (option, optionIndex) =>
            `<li><button type="button" data-option="${optionIndex}">${escapeHtml(option)}</button></li>`,
        )
        .join("");

      return `<li class="quiz-question" data-question="${index}">
<p class="quiz-prompt">${escapeHtml(question.question)}</p>
<ul class="quiz-options">${options}</ul>
<p class="quiz-explanation" data-explanation hidden></p>
</li>`;
    })
    .join("\n");

  return `<div class="quiz" data-quiz data-pagefind-ignore>
<script type="application/json" data-quiz-answers>${encodeQuizPayload(block.questions)}</script>
<ol class="quiz-questions">
${questions}
</ol>
</div>`;
}

/**
 * Оглавление урока сбоку: все написанные шаги.
 *
 * `data-step` — якорь для скрипта прогресса: по нему он расставляет галочки
 * прочитанного, не зная ничего про разметку вокруг.
 *
 * На узком экране колонки нет, и полсотни шагов оттеснили бы сам текст за край
 * экрана — там оглавление свёрнуто под кнопку. Раскрывает его чекбокс, а не
 * скрипт: состояние нужно с первого кадра, иначе список успевал бы мигнуть.
 */
function renderToc(model: LessonModel, currentId: string | null, options: RenderOptions): string {
  const items = model.blocks
    .map((block) => {
      const current = block.step.id === currentId ? " is-current" : "";
      return `<li><a class="toc-link${current}" data-step="${block.step.id}" href="${stepPageUrl(options.basePath, model.slug, block.step.id)}"><span class="toc-mark" aria-hidden="true"></span><span class="toc-number">${block.number}</span><span class="toc-title">${escapeHtml(block.step.title)}</span></a></li>`;
    })
    .join("\n");

  return `<div class="toc-drawer" data-pagefind-ignore>
<input type="checkbox" id="toc-toggle" class="toc-toggle">
<label class="toc-summary" for="toc-toggle">Шаги урока</label>
<nav class="toc" aria-label="Шаги урока"><ol>
${items}
</ol></nav>
</div>`;
}

/**
 * Практика: редактор с заготовкой упражнения и прогон тестов в браузере.
 *
 * В редакторе весь файл упражнения, а не одна функция: тесты импортируют из
 * него все имена сразу, и файл с одной функцией не загрузился бы вовсе.
 * Проверяются при этом только тесты текущего шага.
 */
function renderPractice(block: LessonBlock, options: RenderOptions): string {
  const fn = block.practiceFn;
  if (!fn || (block.step.type !== "code" && block.step.type !== "recall")) return "";

  const exercise = options.exercise;
  if (!exercise) {
    return `<p class="practice">Практика: функция <code>${escapeHtml(fn)}</code>. Упражнение к этому уроку не выложено.</p>`;
  }

  const target = exercise.targets?.find(
    (item) => item.fn === fn && (!block.practiceFile || item.file === block.practiceFile),
  );
  const payload = encodeJson({
    slug: exercise.slug,
    fn,
    file: block.practiceFile,
    functions: exercise.functions,
    multi: exercise.multi ?? false,
    testNodes: target?.tests ?? [],
    urls: exercise.urls,
    assets: {
      pyodide: `${options.basePath}/assets/pyodide/`,
      harness: `${options.basePath}/assets/harness.py`,
    },
  });

  const solution = exercise.urls.solution
    ? `<button type="button" class="nav-button" data-show-solution>Показать решение</button>`
    : "";

  return `<section class="practice-panel" data-pagefind-ignore>
<h2 class="practice-title">Практика: <code>${escapeHtml(fn)}</code></h2>
<p class="practice-hint">Редактируется только функция этого шага — остальной файл упражнения подставится при запуске. Для метода ниже также показан контекст класса: его поля и готовые методы. Код выполняется прямо в твоём браузере: первый запуск качает Python, примерно двенадцать мегабайт, дальше из кэша.</p>
<details class="practice-context" data-context-panel open hidden>
<summary>Контекст класса — только для чтения</summary>
<pre class="solution" data-context></pre>
</details>
<textarea class="code-input" data-code spellcheck="false" rows="18"></textarea>
<div class="practice-actions">
<button type="button" class="nav-button is-primary" data-run>Запустить тесты</button>
<button type="button" class="nav-button" data-reset>Сбросить</button>
${solution}
</div>
<p class="run-status" data-run-status></p>
<div data-results></div>
<section class="console-panel" data-console-panel hidden>
<h3 class="console-title">Консоль</h3>
<pre class="console-output" data-console></pre>
</section>
<pre class="solution" data-solution hidden></pre>
<p class="practice-notice" data-sync-notice hidden></p>
<script type="application/json" data-exercise>${payload}</script>
</section>`;
}

function renderProgressBar(): string {
  return `<div class="progress" data-pagefind-ignore><div class="progress-fill" data-progress-fill></div></div>`;
}

export function renderStepPage(
  model: LessonModel,
  index: number,
  options: RenderOptions,
): string {
  const block = model.blocks[index];
  const previous = model.blocks[index - 1] ?? null;
  const next = model.blocks[index + 1] ?? null;

  const body = renderToStaticMarkup(
    createElement(StepBody, {
      body: block.step.body,
      currentStepNumber: block.number,
      hrefForStep: stepPageHref({
        basePath: options.basePath,
        slug: model.slug,
        stepIds: model.stepIds,
        writtenIds: model.blocks.map((item) => item.step.id),
      }),
    }),
  );

  const visual = block.visualHref
    ? `<iframe class="visual" data-visual src="${escapeHtml(block.visualHref)}" sandbox="allow-scripts" loading="lazy" title="${escapeHtml(block.step.title)}"></iframe>`
    : "";

  const practice = renderPractice(block, options);
  // Скрипт практики нужен только там, где есть редактор: на шаге без
  // выложенного упражнения запускать нечего.
  const hasEditor =
    Boolean(options.exercise) &&
    Boolean(block.practiceFn) &&
    (block.step.type === "code" || block.step.type === "recall");

  const back = previous
    ? `<a class="nav-button" href="${stepPageUrl(options.basePath, model.slug, previous.step.id)}">Назад</a>`
    : `<span class="nav-button is-disabled">Назад</span>`;

  // «Дальше» и «Закончить урок» — обе отмечают текущий шаг прочитанным:
  // последний шаг иначе навсегда оставался бы недочитанным.
  const forward = next
    ? `<a class="nav-button is-primary" data-mark-read href="${stepPageUrl(options.basePath, model.slug, next.step.id)}">Дальше</a>`
    : `<a class="nav-button is-done" data-mark-read href="${lessonUrl(options.basePath, model.slug)}">Закончить урок</a>`;

  // На последнем шаге курс не заканчивается — дальше следующий урок.
  const onward =
    !next && options.nextLesson
      ? `<a class="nav-button" data-mark-read href="${lessonUrl(options.basePath, options.nextLesson.slug)}">Следующий урок: ${escapeHtml(options.nextLesson.title)} →</a>`
      : "";

  // Кнопку показывает скрипт, и только когда сюда пришли по ссылке из текста
  // другого шага. Возврат — history.back(), чтобы вернуться ровно к тому
  // абзацу, из которого ушли.
  const returnButton = `<button type="button" class="return-button" data-return data-pagefind-ignore hidden></button>`;

  const lessonData = encodeJson({
    slug: model.slug,
    stepId: block.step.id,
    number: block.number,
    plannedCount: model.plannedCount,
  });

  const page = `<header class="step-header" data-pagefind-ignore>
<a class="back" href="${lessonUrl(options.basePath, model.slug)}" data-pagefind-meta="lesson">← ${escapeHtml(model.title)}</a>
<span class="step-header-actions" data-header-actions>
<span class="counter" data-counter>${block.number} / ${model.plannedCount}</span>
${renderSearchButton()}
</span>
</header>
${renderProgressBar()}
<div class="lesson-layout">
${renderToc(model, block.step.id, options)}
<main class="lesson">
<article class="step" data-pagefind-body>
<h1 class="step-title" data-pagefind-meta="title">${escapeHtml(block.step.title)}</h1>
${returnButton}
${body}
${visual}
${renderQuiz(block)}
${practice}
</article>
<nav class="step-nav" data-pagefind-ignore>
${back}
<span class="step-nav-forward">
${forward}
${onward}
</span>
</nav>
</main>
</div>
<script type="application/json" data-lesson>${lessonData}</script>`;

  return htmlDocument({
    // Во вкладке шага имени курса нет: шаг и урок уже не помещаются, третьей
    // части никто не увидит.
    title: `${block.step.title} — ${model.title}`,
    basePath: options.basePath,
    body: page,
    // Скрипт практики подключается только там, где есть что запускать: на
    // шаге с теорией ему нечего делать.
    scripts: [PROGRESS_SCRIPT, QUIZ_SCRIPT, FRAME_SCRIPT, ...(hasEditor ? [EXERCISE_SCRIPT] : [])],
    modules: [
      ...authModules(options),
      ...(hasEditor ? [`${options.basePath}/assets/editor.js`] : []),
    ],
  });
}

export function renderLessonIndexPage(model: LessonModel, options: RenderOptions): string {
  const written = new Map(model.blocks.map((block) => [block.step.id, block]));

  const items = model.stepIds
    .map((id, position) => {
      const block = written.get(id);
      if (!block) {
        return `<li class="step-item is-missing"><span class="toc-number">${position + 1}</span><span class="toc-title">ещё не написан</span></li>`;
      }
      return `<li class="step-item"><a class="toc-link" data-step="${id}" href="${stepPageUrl(options.basePath, model.slug, id)}"><span class="toc-number">${block.number}</span><span class="toc-title">${escapeHtml(block.step.title)}</span></a></li>`;
    })
    .join("\n");

  const gap =
    model.writtenCount < model.plannedCount
      ? `<p class="note">Урок ещё пишется: готово ${model.writtenCount} шагов из ${model.plannedCount}.</p>`
      : "";

  const lessonData = encodeJson({ slug: model.slug, plannedCount: model.plannedCount });

  const page = `<header class="lesson-header">
<div class="header-toolbar">
<a class="back" href="${options.basePath}/">← к списку уроков</a>
<span class="header-actions" data-header-actions>${renderSearchButton()}</span>
</div>
<h1>${escapeHtml(model.title)}</h1>
<p class="lesson-meta"><span data-read-count>${model.plannedCount} шагов</span></p>
<p class="lesson-actions">
<a class="nav-button is-primary" data-resume href="#" hidden>Начать урок</a>
</p>
${gap}
</header>
<main class="lesson-index">
<ol class="step-list">
${items}
</ol>
</main>
<script type="application/json" data-lesson>${lessonData}</script>`;

  return htmlDocument({
    title: `${model.title} — ${SITE_TITLE}`,
    basePath: options.basePath,
    body: page,
    excludeFromSearch: true,
    scripts: [LESSON_INDEX_SCRIPT],
    modules: authModules(options),
  });
}

export function renderIndexPage(phases: CatalogPhase[], options: RenderOptions): string {
  const sections = phases
    .map((phase) => {
      const lessons = phase.lessons
        .map((lesson) => {
          const total =
            lesson.writtenCount < lesson.plannedCount
              ? `<span class="partial">${lesson.writtenCount} из ${lesson.plannedCount} шагов</span>`
              : `<span class="full">${lesson.plannedCount} шагов</span>`;

          return `<li data-lesson-slug="${escapeHtml(lesson.slug)}">
<a href="${lessonUrl(options.basePath, lesson.slug)}">
<span class="lesson-number">${lesson.number}</span>
<span class="lesson-title">${escapeHtml(lesson.title)}</span>
<span class="read" data-read hidden></span>
${total}
</a>
</li>`;
        })
        .join("\n");

      return `<section class="phase">
<h2>Фаза ${phase.number}. ${escapeHtml(phase.title)}</h2>
<ul class="lessons">
${lessons}
</ul>
</section>`;
    })
    .join("\n");

  return htmlDocument({
    title: SITE_TITLE,
    basePath: options.basePath,
    body: `<header class="index-header"><div class="header-toolbar"><h1>${SITE_TITLE}</h1><span class="header-actions" data-header-actions>${renderReviewLink(options.basePath)}${renderSearchButton()}</span></div></header>\n${sections}`,
    excludeFromSearch: true,
    scripts: [CATALOG_SCRIPT],
    modules: authModules(options),
  });
}

/**
 * Страница повторений.
 *
 * Внутри пусто: очередь на сегодня зависит от графика в браузере, и на сборке
 * её знать неоткуда. Разметка даёт бандлу только место под карточку и место
 * под поле сдвига дня.
 *
 * Поле сдвига лежит в разметке скрытым, а показывает его скрипт по `?debug=1`:
 * страница статическая и одна на всех, про параметры адреса она узнать не
 * может. Ничего не записывая, поле не испортит график — худшее, что оно
 * делает, это показывает не тот список.
 */
export function renderReviewPage(options: RenderOptions): string {
  const page = `<header class="lesson-header">
<div class="header-toolbar">
<a class="back" href="${options.basePath}/">← к списку уроков</a>
<span class="header-actions" data-header-actions>${renderSearchButton()}</span>
</div>
<h1>Повторение</h1>
<p class="lesson-meta">Карточки, до которых дошёл срок. График живёт в этом браузере.</p>
</header>
<main class="lesson">
<div class="review-debug" data-review-debug hidden>
<label for="review-shift">Показать день +N</label>
<input id="review-shift" type="number" data-review-shift value="0" min="0" max="365" step="1">
<button type="button" class="nav-button" data-review-shift-apply>Пересчитать</button>
<p class="run-status" data-review-shift-note></p>
</div>
<div class="review" data-review>
<p class="run-status">Загружаю карточки…</p>
</div>
</main>`;

  return htmlDocument({
    title: `Повторение — ${SITE_TITLE}`,
    basePath: options.basePath,
    body: page,
    excludeFromSearch: true,
    modules: [...authModules(options), `${options.basePath}/assets/review.js`],
  });
}

/**
 * Страница возврата после входа через GitHub.
 *
 * Единственное место, где виден ход первого слияния. Разбор токена из адреса
 * делает клиент Supabase, сюда он приходит уже с сессией.
 */
export function renderAuthPage(options: { basePath: string }): string {
  return htmlDocument({
    title: `Вход — ${SITE_TITLE}`,
    basePath: options.basePath,
    body: `<header class="index-header"><div class="header-toolbar"><h1>Вход</h1><span class="header-actions" data-header-actions>${renderSearchButton()}</span></div></header>
<main class="lesson">
<p class="run-status" data-auth-status>Проверяю вход…</p>
<a class="nav-button" data-auth-back href="${options.basePath}/">К курсу</a>
</main>`,
    excludeFromSearch: true,
    modules: [`${options.basePath}/assets/auth.js`],
    scripts: [AUTH_PAGE_SCRIPT],
  });
}
