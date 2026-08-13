import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StepBody } from "../../components/StepBody";
import { anchorHrefForStep } from "./anchors";
import type { CatalogPhase } from "./catalog";
import { FRAME_SCRIPT, QUIZ_SCRIPT } from "./client";
import type { LessonBlock, LessonModel } from "./lesson-page";
import { encodeQuizPayload } from "./quiz";

export interface RenderOptions {
  basePath: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlDocument(options: {
  title: string;
  basePath: string;
  body: string;
  scripts?: string[];
}): string {
  const scripts = (options.scripts ?? []).map((code) => `<script>${code}</script>`).join("\n");

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

function renderBlock(block: LessonBlock, stepIds: string[]): string {
  const body = renderToStaticMarkup(
    createElement(StepBody, {
      body: block.step.body,
      currentStepNumber: block.number,
      hrefForStep: anchorHrefForStep(stepIds),
    }),
  );

  const visual = block.visualHref
    ? `<iframe class="visual" data-visual src="${escapeHtml(block.visualHref)}" sandbox="allow-scripts" loading="lazy" title="${escapeHtml(block.step.title)}"></iframe>`
    : "";

  const practice =
    block.practiceFn && (block.step.type === "code" || block.step.type === "recall")
      ? `<p class="practice">Практика: функция <code>${escapeHtml(block.practiceFn)}</code>. Писать код — в локальном приложении курса.</p>`
      : "";

  return `<section class="step" id="${block.anchor}">
<h2 class="step-title"><span class="step-number">${block.number}</span>${escapeHtml(block.step.title)}</h2>
${body}
${visual}
${renderQuiz(block)}
${practice}
</section>`;
}

export function renderLessonPage(model: LessonModel, options: RenderOptions): string {
  const toc = model.blocks
    .map(
      (block) =>
        `<li><a href="#${block.anchor}"><span class="toc-number">${block.number}</span>${escapeHtml(block.step.title)}</a></li>`,
    )
    .join("\n");

  const gap =
    model.writtenCount < model.plannedCount
      ? `<p class="note">Урок ещё пишется: готово ${model.writtenCount} шагов из ${model.plannedCount}.</p>`
      : "";

  const body = `<header class="lesson-header">
<a class="back" href="${options.basePath}/">← к списку уроков</a>
<h1>${escapeHtml(model.title)}</h1>
${gap}
</header>
<div class="lesson-layout">
<nav class="toc" aria-label="Шаги урока"><ol>
${toc}
</ol></nav>
<main class="lesson">
${model.blocks.map((block) => renderBlock(block, model.stepIds)).join("\n")}
</main>
</div>`;

  return htmlDocument({
    title: model.title,
    basePath: options.basePath,
    body,
    scripts: [QUIZ_SCRIPT, FRAME_SCRIPT],
  });
}

export function renderIndexPage(phases: CatalogPhase[], options: RenderOptions): string {
  const sections = phases
    .map((phase) => {
      const lessons = phase.lessons
        .map((lesson) => {
          const progress =
            lesson.writtenCount < lesson.plannedCount
              ? `<span class="partial">${lesson.writtenCount} из ${lesson.plannedCount} шагов</span>`
              : `<span class="full">${lesson.plannedCount} шагов</span>`;

          return `<li>
<a href="${options.basePath}/lesson/${escapeHtml(lesson.slug)}/">
<span class="lesson-number">${lesson.number}</span>
<span class="lesson-title">${escapeHtml(lesson.title)}</span>
${progress}
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
  });
}
