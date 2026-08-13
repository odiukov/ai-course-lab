import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StepBody } from "../../components/StepBody";
import { lessonUrl, stepPageHref, stepPageUrl } from "./anchors";
import type { CatalogPhase } from "./catalog";
import {
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

export interface NextLesson {
  slug: string;
  title: string;
}

export interface ExercisePanelData {
  /** Каталог упражнения, он же ключ хранения кода. */
  slug: string;
  /** Канонический состав упражнения — по нему отбираются тесты шага. */
  functions: string[];
  urls: ExerciseUrls;
}

export interface RenderOptions {
  basePath: string;
  /** Следующий урок курса — куда идти, когда этот дочитан. */
  nextLesson?: NextLesson | null;
  /** Упражнение урока, если оно есть. */
  exercise?: ExercisePanelData | null;
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

function htmlDocument(options: {
  title: string;
  basePath: string;
  body: string;
  scripts?: string[];
  /** Внешние файлы скриптов сайта: грузятся до инлайновых. */
  modules?: string[];
}): string {
  const scripts = [
    ...(options.modules ?? []).map((src) => `<script src="${src}"></script>`),
    ...(options.scripts ?? []).map((code) => `<script>${code}</script>`),
  ].join("\n");

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<link rel="stylesheet" href="${options.basePath}/assets/katex/katex.min.css">
<link rel="stylesheet" href="${options.basePath}/assets/site.css">
</head>
<body>
${options.body}
${scripts}
</body>
</html>
`;
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

  return `<div class="quiz" data-quiz>
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
 */
function renderToc(model: LessonModel, currentId: string | null, options: RenderOptions): string {
  const items = model.blocks
    .map((block) => {
      const current = block.step.id === currentId ? " is-current" : "";
      return `<li><a class="toc-link${current}" data-step="${block.step.id}" href="${stepPageUrl(options.basePath, model.slug, block.step.id)}"><span class="toc-mark" aria-hidden="true"></span><span class="toc-number">${block.number}</span><span class="toc-title">${escapeHtml(block.step.title)}</span></a></li>`;
    })
    .join("\n");

  return `<nav class="toc" aria-label="Шаги урока"><ol>
${items}
</ol></nav>`;
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

  const payload = encodeJson({
    slug: exercise.slug,
    fn,
    functions: exercise.functions,
    urls: exercise.urls,
    assets: {
      pyodide: `${options.basePath}/assets/pyodide/`,
      harness: `${options.basePath}/assets/harness.py`,
    },
  });

  const solution = exercise.urls.solution
    ? `<button type="button" class="nav-button" data-show-solution>Показать решение</button>`
    : "";

  return `<section class="practice-panel">
<h2 class="practice-title">Практика: <code>${escapeHtml(fn)}</code></h2>
<p class="practice-hint">Код выполняется прямо здесь, в твоём браузере. Первый запуск качает Python — примерно десять мегабайт, дальше из кэша.</p>
<textarea class="code-input" data-code spellcheck="false" rows="18"></textarea>
<div class="practice-actions">
<button type="button" class="nav-button is-primary" data-run>Запустить тесты</button>
<button type="button" class="nav-button" data-reset>Сбросить</button>
${solution}
</div>
<p class="run-status" data-run-status></p>
<div data-results></div>
<pre class="solution" data-solution hidden></pre>
<script type="application/json" data-exercise>${payload}</script>
</section>`;
}

function renderProgressBar(): string {
  return `<div class="progress"><div class="progress-fill" data-progress-fill></div></div>`;
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
  const returnButton = `<button type="button" class="return-button" data-return hidden></button>`;

  const lessonData = encodeJson({
    slug: model.slug,
    stepId: block.step.id,
    number: block.number,
    plannedCount: model.plannedCount,
  });

  const page = `<header class="step-header">
<a class="back" href="${lessonUrl(options.basePath, model.slug)}">← ${escapeHtml(model.title)}</a>
<span class="counter" data-counter>${block.number} / ${model.plannedCount}</span>
</header>
${renderProgressBar()}
<div class="lesson-layout">
${renderToc(model, block.step.id, options)}
<main class="lesson">
<article class="step">
<h1 class="step-title">${escapeHtml(block.step.title)}</h1>
${returnButton}
${body}
${visual}
${renderQuiz(block)}
${practice}
</article>
<nav class="step-nav">
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
    title: `${block.step.title} — ${model.title}`,
    basePath: options.basePath,
    body: page,
    // Скрипт практики подключается только там, где есть что запускать: на
    // шаге с теорией ему нечего делать.
    scripts: [PROGRESS_SCRIPT, QUIZ_SCRIPT, FRAME_SCRIPT, ...(hasEditor ? [EXERCISE_SCRIPT] : [])],
    modules: hasEditor ? [`${options.basePath}/assets/editor.js`] : [],
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
<a class="back" href="${options.basePath}/">← к списку уроков</a>
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
    title: model.title,
    basePath: options.basePath,
    body: page,
    scripts: [LESSON_INDEX_SCRIPT],
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
    title: "Курс",
    basePath: options.basePath,
    body: `<header class="index-header"><h1>Курс</h1></header>\n${sections}`,
    scripts: [CATALOG_SCRIPT],
  });
}
