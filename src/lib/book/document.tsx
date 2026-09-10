import { renderToStaticMarkup } from "react-dom/server";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { StaticStepBody } from "../../components/StaticStepBody";
import type { BookModel } from "./build";

const BOOK_CSS = String.raw`
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: white; color: #172033; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.55; }
.book-root { margin: 0 auto; max-width: 860px; }
.book-cover { display: flex; min-height: 255mm; break-after: page; flex-direction: column; justify-content: center; border-top: 10px solid #4f46e5; padding: 12mm 10mm; }
.book-eyebrow { color: #4f46e5; font-size: 11pt; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
.book-cover h1 { margin: 12mm 0 4mm; max-width: 18ch; font-size: 38pt; line-height: 1.05; }
.book-cover p { color: #64748b; font-size: 13pt; }
.book-contents { break-after: page; padding: 8mm 0; }
.book-contents h2 { margin-bottom: 8mm; font-size: 24pt; }
.book-contents ol { columns: 2; column-gap: 12mm; list-style: none; padding: 0; }
.book-contents li { break-inside: avoid; margin-bottom: 3mm; }
.book-contents a { color: inherit; text-decoration: none; }
.book-lesson { break-before: page; }
.book-lesson-header { margin-bottom: 10mm; border-bottom: 1px solid #cbd5e1; padding-bottom: 5mm; }
.book-lesson-number { color: #4f46e5; font-size: 10pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.book-lesson-header h2 { margin: 2mm 0 0; font-size: 27pt; line-height: 1.12; }
.book-section { margin: 0 0 9mm; }
.book-section > h3 { break-after: avoid; margin: 8mm 0 3mm; color: #312e81; font-size: 17pt; line-height: 1.25; }
.book-step-number { margin-right: .4em; color: #94a3b8; }
.book-visual { width: 100%; height: 520px; margin: 5mm 0 7mm; break-inside: avoid; border: 1px solid #dbe3ef; border-radius: 8px; }
.book-clarification { margin: 5mm 0; break-inside: avoid; border-left: 3px solid #818cf8; background: #f5f7ff; padding: 3mm 5mm; }
.book-clarification h4 { margin: 0 0 2mm; color: #3730a3; font-size: 11pt; }
.book-solutions { break-before: page; }
.book-solutions h3 { font-size: 20pt; }
.book-solution-file { margin: 6mm 0; }
.book-solution-file h4 { margin: 0 0 2mm; font-family: Menlo, Monaco, monospace; font-size: 10pt; }
.book-solution-file pre { overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid #dbe3ef; border-radius: 6px; background: #f8fafc; padding: 4mm; font-family: Menlo, Monaco, monospace; font-size: 7.5pt; line-height: 1.45; }
.book-footer { display: none; }
.lesson-step-body { color: #263244; }
.lesson-step-body p { margin: 0 0 3.5mm; }
.lesson-step-body h1, .lesson-step-body h2 { break-after: avoid; margin: 6mm 0 2.5mm; font-size: 15pt; }
.lesson-step-body h3, .lesson-step-body h4 { break-after: avoid; margin: 5mm 0 2mm; }
.lesson-step-body ul, .lesson-step-body ol { margin: 0 0 4mm; padding-left: 7mm; }
.lesson-step-body li { margin-bottom: 1.5mm; }
.lesson-step-body a { color: #4338ca; text-decoration: underline; text-underline-offset: 2px; }
.lesson-step-body code { border-radius: 3px; background: #eef2f7; padding: .2em .35em; font-family: Menlo, Monaco, monospace; font-size: .88em; }
.lesson-step-body pre { break-inside: avoid; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid #dbe3ef; border-radius: 6px; background: #f8fafc; padding: 4mm; font-size: 8pt; }
.lesson-step-body pre code { background: transparent; padding: 0; }
.lesson-step-body blockquote { break-inside: avoid; margin: 4mm 0; border-left: 3px solid #a5b4fc; background: #f8fafc; padding: 2.5mm 4mm; color: #475569; }
.lesson-step-body table { width: 100%; break-inside: avoid; border-collapse: collapse; margin: 4mm 0; font-size: 9pt; }
.lesson-step-body th, .lesson-step-body td { border: 1px solid #cbd5e1; padding: 2mm; text-align: left; vertical-align: top; }
.lesson-step-body img { max-width: 100%; }
.katex-display { break-inside: avoid; overflow: hidden; }
@page {
  size: A4;
  margin: 16mm 17mm 18mm;
  @bottom-right {
    content: "AI Engineering · " counter(page);
    color: #94a3b8;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8pt;
  }
}
@media print {
  .book-root { max-width: none; }
}
`;

function formattedDate(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(date);
}

function BookPhase({ book }: { book: BookModel }) {
  return (
    <>
      <div className="book-footer">AI Engineering · фаза {book.phaseNumber}</div>
      <section className="book-cover">
        <div className="book-eyebrow">AI Engineering from Scratch</div>
        <h1>{book.phaseTitle}</h1>
        <p>Фаза {book.phaseNumber} · теория и готовые реализации</p>
        <p>Собрано из актуальных материалов {formattedDate(book.generatedAt)}</p>
      </section>

      <nav className="book-contents" aria-label="Содержание">
        <h2>Содержание</h2>
        <ol>
          {book.lessons.map((lesson) => (
            <li key={lesson.slug}>
              <a href={`#lesson-${lesson.slug}`}>{lesson.number}. {lesson.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      {book.lessons.map((lesson) => (
        <article className="book-lesson" id={`lesson-${lesson.slug}`} key={lesson.slug}>
          <header className="book-lesson-header">
            <div className="book-lesson-number">Урок {lesson.number}</div>
            <h2>{lesson.title}</h2>
          </header>
          {lesson.sections.map((section) => (
            <section className="book-section" id={`lesson-${lesson.slug}-step-${section.number}`} key={section.id}>
              <h3><span className="book-step-number">{section.number}.</span>{section.title}</h3>
              {section.visualHtml && (
                <iframe
                  className="book-visual"
                  srcDoc={section.visualHtml}
                  sandbox="allow-scripts"
                  title={section.title}
                />
              )}
              {!section.visualHtml && section.visualHref && (
                <div
                  className="book-visual-placeholder"
                  data-visual-src={section.visualHref}
                  data-visual-title={section.title}
                />
              )}
              <StaticStepBody body={section.body} currentStepNumber={section.number} lessonSlug={lesson.slug} />
              {section.clarifications.map((item) => (
                <aside className="book-clarification" key={`${item.askedAt}-${item.question}`}>
                  <h4>{item.question}</h4>
                  <StaticStepBody body={item.answer} />
                </aside>
              ))}
            </section>
          ))}
          {lesson.solutions.length > 0 && (
            <section className="book-solutions">
              <h3>Готовая реализация</h3>
              <p>Итоговые файлы вместо интерактивных упражнений.</p>
              {lesson.solutions.map((solution) => (
                <div className="book-solution-file" key={solution.name}>
                  <h4>{solution.name}</h4>
                  <pre><code>{solution.code}</code></pre>
                </div>
              ))}
            </section>
          )}
        </article>
      ))}
    </>
  );
}

function BookDocument({ books }: { books: BookModel[] }) {
  return (
    <main className="book-root">
      {books.map((book) => <BookPhase book={book} key={book.phaseNumber} />)}
    </main>
  );
}

const STATIC_BOOK_CSS = String.raw`
.book-toolbar { position: sticky; z-index: 10; top: 0; display: flex; gap: 18px; align-items: center; justify-content: space-between; margin: 0 auto; max-width: 860px; border-bottom: 1px solid #dbe3ef; background: rgb(255 255 255 / .96); padding: 12px 18px; box-shadow: 0 6px 18px rgb(15 23 42 / .08); }
.book-toolbar-copy { display: flex; flex: 1; flex-direction: column; }
.book-toolbar-copy span { color: #64748b; font-size: 9pt; }
.book-toolbar a, .book-toolbar button { border: 1px solid #cbd5e1; border-radius: 7px; background: white; color: #172033; padding: 8px 13px; font: inherit; font-size: 10pt; text-decoration: none; cursor: pointer; }
.book-toolbar button { border-color: #4338ca; background: #4338ca; color: white; font-weight: 700; }
.book-toolbar button:disabled { cursor: wait; opacity: .45; }
.book-loading { margin: 12mm auto; max-width: 860px; color: #64748b; }
.book-download { margin: 12vh auto; max-width: 680px; padding: 24px; text-align: center; }
.book-download a { display: inline-block; margin-top: 16px; border-radius: 7px; background: #4338ca; color: white; padding: 10px 16px; font-weight: 700; text-decoration: none; }
.book-visual-placeholder { width: 100%; height: 520px; margin: 5mm 0 7mm; border: 1px solid #dbe3ef; border-radius: 8px; background: #f8fafc; }
@media (max-width: 680px) { .book-toolbar { flex-wrap: wrap; } .book-toolbar-copy { order: -1; flex-basis: 100%; } }
@media print { .book-toolbar { display: none; } }
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderBookHtml(book: BookModel, root: string = process.cwd()): string {
  const katexCss = pathToFileURL(path.join(root, "node_modules/katex/dist/katex.min.css")).href;
  const markup = renderToStaticMarkup(<BookDocument books={[book]} />);
  const title = `AI Engineering · фаза ${book.phaseNumber}`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="${katexCss}"><style>${BOOK_CSS}</style></head><body>${markup}</body></html>`;
}

/**
 * Статическая печатная книга для GitHub Pages.
 *
 * Серверного API у Pages нет, поэтому каталог ведёт сюда с `?print=1`: после
 * загрузки всех встроенных схем страница открывает системный диалог печати.
 * Кнопка в шапке остаётся запасным и повторным способом сохранить PDF.
 */
export function renderStaticBookHtml(options: {
  basePath: string;
  title: string;
  fragments: string[];
}): string {
  const markup = renderToStaticMarkup(
    <>
      <aside className="book-toolbar" data-pagefind-ignore="all">
        <a href={`${options.basePath}/`}>← К курсу</a>
        <span className="book-toolbar-copy">
          <strong>{options.title}</strong>
          <span data-book-status>Собираю актуальные материалы…</span>
        </span>
        <button type="button" data-print-book disabled>Сохранить в PDF</button>
      </aside>
      <main className="book-root" data-book-root>
        <p className="book-loading" data-book-loading>Загружаю книгу…</p>
      </main>
    </>,
  );
  const fragments = JSON.stringify(options.fragments).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<link rel="stylesheet" href="${options.basePath}/assets/katex/katex.min.css">
<style>${BOOK_CSS}\n${STATIC_BOOK_CSS}</style>
</head>
<body data-pagefind-ignore="all">
${markup}
<script type="application/json" data-book-fragments>${fragments}</script>
<script src="${options.basePath}/assets/book.js"></script>
</body>
</html>`;
}

/** Один фрагмент хранится один раз: его открывает книга фазы и общая книга. */
export function renderStaticBookPhaseHtml(book: BookModel): string {
  return renderToStaticMarkup(<BookPhase book={book} />);
}

/** Запасная страница для старой ссылки /book/: сразу ведёт на готовый релиз. */
export function renderStaticBookDownloadHtml(options: {
  basePath: string;
  downloadUrl: string;
}): string {
  const markup = renderToStaticMarkup(
    <main className="book-download" data-pagefind-ignore="all">
      <h1>Полная книга готова</h1>
      <p>Скачивание должно начаться автоматически.</p>
      <a href={options.downloadUrl}>Скачать PDF</a>
      <p><a href={`${options.basePath}/`}>← Вернуться к курсу</a></p>
    </main>,
  );
  const downloadUrl = JSON.stringify(options.downloadUrl).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Полная книга · AI Engineering</title><style>${BOOK_CSS}\n${STATIC_BOOK_CSS}</style></head><body data-pagefind-ignore="all">${markup}<script>window.location.replace(${downloadUrl})</script></body></html>`;
}
