# Course Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить полнотекстовый поиск по всем опубликованным шагам курса с ленивой загрузкой Pagefind, доступной с клавиатуры и из шапки каждой страницы модалкой.

**Architecture:** Статический рендер помечает только содержимое отдельной страницы шага как поисковое и отдаёт Pagefind заголовок шага и урока как metadata. Отдельный build-step индексирует готовый `out/`; браузерный адаптер `PagefindProvider` лениво импортирует сгенерированный Pagefind API, а независимая модалка работает только с собственным `SearchProvider` и тестируется на fake-провайдере.

**Tech Stack:** TypeScript, Node 22, React 19 + `react-dom/server`, Pagefind 1.5.2, esbuild, DOM API, happy-dom, vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-course-search-design.md`

## File map

- `src/lib/site/render.tsx` — HTML-разметка Pagefind, кнопка поиска и подключение браузерного бандла на статических страницах.
- `src/lib/site/render.test.ts` — контракт индексируемой/исключённой разметки и подключения поиска.
- `src/site-search/search-provider.ts` — единственный внутренний контракт результатов поиска.
- `src/site-search/pagefind-provider.ts` — единственное место, которое знает runtime API Pagefind и переводит его результат в `SearchHit`.
- `src/site-search/modal.ts` — DOM модалки, debounce, состояния, клавиатурная навигация и переходы; зависит только от `SearchProvider`.
- `src/site-search/modal.test.ts` — happy-dom тесты модалки на fake-провайдере.
- `src/site-search/index.ts` — тонкая браузерная точка входа, связывающая адаптер с модалкой.
- `src/styles/site.css` — адаптивное оформление кнопки, overlay, диалога и результатов.
- `scripts/build-site.mts` — сборка `assets/search.js`; построение HTML остаётся отдельным от индексации.
- `package.json`, `package-lock.json` — фиксированная версия Pagefind и команды `site:pages`, `site:index`, `site:build`.

## Global constraints

- Перед правками перечитать затрагиваемый файл: параллельная ветка `review-cards-and-search` может изменить `package.json`, `render.tsx` и тестовые fixture. Не переносить файлы из её незакоммиченного checkout и не использовать `git add -A`/`git commit -a`.
- Комментарии в коде — по-русски и объясняют причину решения. Сообщения коммитов — по-английски в существующем стиле.
- Поисковая единица — одна страница шага. Главная, `/auth/` и оглавления уроков не должны появляться среди результатов.
- `src/site-search/pagefind-provider.ts` — единственный файл, который знает runtime API и форму результата Pagefind. Composition root `index.ts` только выбирает эту реализацию, а `modal.ts` импортирует лишь `SearchProvider`/`SearchHit`.
- Pagefind загружается при первом открытии, а не при загрузке страницы: фабрика провайдера вызывается лениво из `installSearch`.
- Pagefind возвращает URL относительно корня `out/` (например, `/lesson/course/001-step/`); адаптер добавляет `document.body.dataset.base`, чтобы опубликованная ссылка стала `/ai-course-lab/lesson/course/001-step/`.
- `excerpt` — безопасный HTML, созданный Pagefind, с единственной нужной разметкой `<mark>`; `title` и `lesson` всегда вставляются через `textContent`.
- Индекс принудительно строится как русский (`--force-language ru`); документ уже остаётся `<html lang="ru">`. Pagefind 1.5.2 заявляет русский UI и stemming.
- `site:pages` строит HTML/ассеты без индекса, `site:index` индексирует уже существующий `out/`, `site:build` последовательно запускает оба шага.
- Vitest собирает `src/**/*.test.ts`; тест модалки остаётся `.ts`, использует собственный `Window` из happy-dom и не меняет глобальный `document`.
- Не добавлять фильтры, историю, подсказки, поиск по clarifications, коду упражнений или решениям.

## External contracts checked for Pagefind 1.5.2

- Browser API: `import("/pagefind/pagefind.js")`, `init()`, `search()`, затем `result.data()` — <https://pagefind.app/docs/api/>.
- `data-pagefind-body`, `data-pagefind-ignore` и исключение страниц без body — <https://pagefind.app/docs/indexing/>.
- `data-pagefind-meta` — <https://pagefind.app/docs/metadata/>; безопасный HTML поля `excerpt` — <https://pagefind.app/docs/api/>.
- CLI `pagefind --site out --force-language ru` и выход в `out/pagefind/` — <https://pagefind.app/docs/running-pagefind/> и <https://pagefind.app/docs/config-options/>.

---

### Task 1: Ограничить индекс содержимым шага

**Files:**
- Modify: `src/lib/site/render.tsx:60-430`
- Test: `src/lib/site/render.test.ts:32-290`

**Interfaces:**
- `htmlDocument` получает `excludeFromSearch?: boolean` и при нём ставит `data-pagefind-ignore="all"` на `<body>`.
- У страницы шага `<article class="step">` получает `data-pagefind-body`; заголовок шага и имя урока — metadata.
- Все повторяющиеся служебные блоки внутри/рядом с article получают `data-pagefind-ignore`.

- [ ] **Step 1: Написать падающие тесты контракта индекса**

Внутри существующего `describe("renderStepPage")` добавить:

```ts
  it("marks only the step content for Pagefind and exposes result metadata", () => {
    const html = renderStepPage(model(allWritten), 1, { basePath: "/base" });

    expect(html).toContain('<article class="step" data-pagefind-body>');
    expect(html).toContain(
      '<h1 class="step-title" data-pagefind-meta="title">Проверка</h1>',
    );
    expect(html).toContain('data-pagefind-meta="lesson">← Урок</a>');
    expect(html).toContain('<header class="step-header" data-pagefind-ignore>');
    expect(html).toContain('<div class="toc-drawer" data-pagefind-ignore>');
    expect(html).toContain('<nav class="step-nav" data-pagefind-ignore>');
  });
```

В существующий тест `embeds the answers of a check step as JSON` добавить:

```ts
    expect(html).toContain('<div class="quiz" data-pagefind-ignore>');
```

В существующий тест `gives a code step an editor, the exercise files and the step's function` добавить:

```ts
    expect(html).toContain('<section class="practice-panel" data-pagefind-ignore>');
```

Внутри существующего `describe("renderLessonIndexPage")` добавить:

```ts
  it("excludes the lesson table of contents from Pagefind", () => {
    const html = renderLessonIndexPage(model(allWritten), { basePath: "/base" });

    expect(html).toContain('<body data-base="/base" data-pagefind-ignore="all">');
    expect(html).not.toContain("data-pagefind-body");
  });
```

Внутри существующего `describe("renderIndexPage")` добавить:

```ts
  it("excludes the catalog from step search results", () => {
    const html = renderIndexPage([], { basePath: "/base" });

    expect(html).toContain('<body data-base="/base" data-pagefind-ignore="all">');
    expect(html).not.toContain("data-pagefind-body");
  });
```

- [ ] **Step 2: Прогнать тест и увидеть отсутствие Pagefind-атрибутов**

Run: `rtk npx vitest run src/lib/site/render.test.ts`

Expected: FAIL на первом новом `toContain`, потому что `data-pagefind-body` ещё не рендерится.

- [ ] **Step 3: Добавить управление индексированием в `htmlDocument`**

Расширить options и формирование `<body>`:

```ts
function htmlDocument(options: {
  title: string;
  basePath: string;
  body: string;
  scripts?: string[];
  /** Внешние файлы скриптов сайта: грузятся до инлайновых. */
  modules?: string[];
  /** Страница служебная и не должна становиться результатом поиска. */
  excludeFromSearch?: boolean;
}): string {
  const scripts = [
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
```

- [ ] **Step 4: Пометить содержимое и служебные блоки страницы шага**

Изменить открывающие теги в соответствующих helper-функциях:

```ts
  return `<div class="quiz" data-pagefind-ignore>
```

```ts
  return `<div class="toc-drawer" data-pagefind-ignore>
```

```ts
  return `<section class="practice-panel" data-pagefind-ignore>
```

```ts
function renderProgressBar(): string {
  return `<div class="progress" data-pagefind-ignore><div class="progress-fill" data-progress-fill></div></div>`;
}
```

Пометить кнопку возврата:

```ts
  const returnButton = `<button type="button" class="return-button" data-return data-pagefind-ignore hidden></button>`;
```

В шаблоне `renderStepPage` заменить нужные открывающие теги:

```ts
  const page = `<header class="step-header" data-pagefind-ignore>
<a class="back" data-pagefind-meta="lesson" href="${lessonUrl(options.basePath, model.slug)}">← ${escapeHtml(model.title)}</a>
<span class="counter" data-counter>${block.number} / ${model.plannedCount}</span>
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
```

Metadata урока намеренно остаётся внутри `data-pagefind-ignore` без значения `all`: Pagefind исключит текст шапки из body, но прочитает metadata.

- [ ] **Step 5: Явно исключить все страницы, которые не являются шагами**

В вызовы `htmlDocument` из `renderLessonIndexPage`, `renderIndexPage` и `renderAuthPage` добавить:

```ts
    excludeFromSearch: true,
```

Вызов из `renderStepPage` не меняется: эта страница содержит `data-pagefind-body`.

- [ ] **Step 6: Прогнать тесты рендера**

Run: `rtk npx vitest run src/lib/site/render.test.ts src/lib/site/splice.test.ts`

Expected: PASS — тесты рендера и splice проходят, новые атрибуты присутствуют только в ожидаемых местах.

- [ ] **Step 7: Коммит**

```bash
rtk git add src/lib/site/render.tsx src/lib/site/render.test.ts
rtk git commit -m "feat(search): mark static step content for indexing" -- src/lib/site/render.tsx src/lib/site/render.test.ts
```

---

### Task 2: Разделить сборку страниц и индекса

**Files:**
- Modify: `package.json:5-22`
- Modify: `package-lock.json`
- Modify: `scripts/build-site.mts:1-6`

**Interfaces:**
- `npm run site:pages` пересоздаёт `out/` и собирает HTML/ассеты без Pagefind.
- `npm run site:index` читает существующий `out/` и создаёт `out/pagefind/` с русским индексом.
- `npm run site:build` всегда запускает pages, затем index; `site:publish` сохраняет нынешний вызов `site:build`.

- [ ] **Step 1: Установить зафиксированную в спецификации версию Pagefind**

Run: `rtk npm install --save-dev --save-exact pagefind@1.5.2`

Expected: `package.json` содержит `"pagefind": "1.5.2"` в `devDependencies`, lockfile обновлён.

- [ ] **Step 2: Разделить npm scripts**

Заменить существующий `site:build` и добавить два соседних script:

```json
    "site:pages": "tsx --env-file-if-exists=.env.local scripts/build-site.mts",
    "site:index": "pagefind --site out --force-language ru",
    "site:build": "npm run site:pages && npm run site:index",
    "site:publish": "npm run site:build && tsx scripts/publish-site.mts",
```

- [ ] **Step 3: Обновить комментарий запуска в `scripts/build-site.mts`**

Начало файла должно честно различать режимы:

```ts
// Сборка статических страниц курса: текст шагов, схемы, вопросы и браузерные
// ассеты. Поисковый индекс строится отдельной командой после этого файла.
//
// Запуск без индекса: npm run site:pages
// Полная сборка:      npm run site:build
// BASE_PATH=/custom-prefix переопределяет префикс адресов в обоих режимах.
```

- [ ] **Step 4: Проверить независимую сборку страниц**

Run: `rtk npm run site:pages`

Expected: последняя строка начинается с `Собрано: уроков` и содержит поле `шагов`; `out/index.html` существует, `out/pagefind/` ещё не существует, потому что `build-site.mts` в начале очищает `out/`.

- [ ] **Step 5: Построить индекс отдельно**

Run: `rtk npm run site:index`

Expected: Pagefind сообщает русский индекс и количество найденных страниц шага; существуют `out/pagefind/pagefind.js`, `out/pagefind/pagefind-entry.json` и shard-файлы.

- [ ] **Step 6: Проверить композицию полной сборки**

Run: `rtk npm run site:build`

Expected: сначала появляется отчёт `Собрано: уроков`, затем отчёт Pagefind; после команды `out/pagefind/pagefind.js` существует.

- [ ] **Step 7: Коммит**

```bash
rtk git add package.json package-lock.json scripts/build-site.mts
rtk git commit -m "build(search): index static site with Pagefind" -- package.json package-lock.json scripts/build-site.mts
```

---

### Task 3: Спрятать Pagefind за SearchProvider

**Files:**
- Create: `src/site-search/search-provider.ts`
- Create: `src/site-search/pagefind-provider.ts`

**Interfaces:**
- Produces `SearchHit` и `SearchProvider` ровно в форме спецификации.
- Produces `PagefindProvider`, который начинает runtime import в конструкторе, возвращает максимум 20 результатов и добавляет `basePath` к внутренним URL.
- Сам Pagefind не подменяется и не тестируется unit-тестом; его реальный контракт проверяется интеграционной сборкой в Task 6.

- [ ] **Step 1: Создать независимый контракт `src/site-search/search-provider.ts`**

```ts
/** Результат, который умеет показать поиск; источник результата здесь не виден. */
export interface SearchHit {
  title: string;
  lesson: string;
  url: string;
  /** Безопасный HTML фрагмента: текст экранирован, совпадения обёрнуты в mark. */
  excerpt: string;
}

/** Всё, что модалке разрешено знать о поисковом движке. */
export interface SearchProvider {
  search(query: string): Promise<SearchHit[]>;
}
```

- [ ] **Step 2: Создать адаптер `src/site-search/pagefind-provider.ts`**

```ts
import type { SearchHit, SearchProvider } from "./search-provider";

interface PagefindResultData {
  url: string;
  excerpt: string;
  meta: Record<string, unknown>;
}

interface PagefindResultRef {
  data(): Promise<PagefindResultData>;
}

interface PagefindApi {
  init(): Promise<void> | void;
  search(query: string): Promise<{ results: PagefindResultRef[] }>;
}

const RESULT_LIMIT = 20;

/**
 * Import остаётся динамическим выражением: esbuild не должен искать
 * сгенерированный Pagefind-модуль во время сборки search.js.
 */
function importPagefind(url: string): Promise<PagefindApi> {
  return import(url) as Promise<PagefindApi>;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function resultUrl(basePath: string, url: string): string {
  if (/^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith("#")) return url;

  const pathname = url.startsWith("/") ? url : `/${url}`;
  if (!basePath || pathname === basePath || pathname.startsWith(`${basePath}/`)) {
    return pathname;
  }
  return `${basePath}${pathname}`;
}

/** Единственное место проекта, которое знает форму браузерного API Pagefind. */
export class PagefindProvider implements SearchProvider {
  private readonly api: Promise<PagefindApi>;

  constructor(private readonly basePath: string) {
    this.api = importPagefind(`${basePath}/pagefind/pagefind.js`).then(async (pagefind) => {
      await pagefind.init();
      return pagefind;
    });
  }

  async search(query: string): Promise<SearchHit[]> {
    const pagefind = await this.api;
    const response = await pagefind.search(query);
    const data = await Promise.all(
      response.results.slice(0, RESULT_LIMIT).map((result) => result.data()),
    );

    return data.map((result) => ({
      title: text(result.meta.title, "Без названия"),
      lesson: text(result.meta.lesson, "Урок не указан"),
      url: resultUrl(this.basePath, result.url),
      excerpt: result.excerpt,
    }));
  }
}
```

- [ ] **Step 3: Проверить типы и границу зависимости**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

Run: `rtk rg -n "pagefind" src/site-search`

Expected: имя Pagefind встречается только в `src/site-search/pagefind-provider.ts`; `search-provider.ts` не знает стороннюю библиотеку.

- [ ] **Step 4: Коммит**

```bash
rtk git add src/site-search/search-provider.ts src/site-search/pagefind-provider.ts
rtk git commit -m "feat(search): isolate Pagefind behind provider" -- src/site-search/search-provider.ts src/site-search/pagefind-provider.ts
```

---

### Task 4: Реализовать и протестировать независимую модалку

**Files:**
- Create: `src/site-search/modal.test.ts`
- Create: `src/site-search/modal.ts`

**Interfaces:**
- Produces `installSearch(providerFactory, document?, debounceMs?) => cleanup`.
- Фабрика провайдера вызывается только при первом открытии; это граница ленивой загрузки.
- Модалка сама отвечает за debounce, race между запросами, активный результат, focus/close и состояния ответа.

- [ ] **Step 1: Написать happy-dom тесты на fake-провайдере**

Создать `src/site-search/modal.test.ts`:

```ts
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installSearch } from "./modal";
import type { SearchHit, SearchProvider } from "./search-provider";

const HITS: SearchHit[] = [
  {
    title: "Softmax",
    lesson: "Вероятности",
    url: "/base/lesson/probabilities/010-softmax/",
    excerpt: "Нормируем <mark>экспоненты</mark>.",
  },
  {
    title: "Каузальная маска",
    lesson: "Трансформеры",
    url: "/base/lesson/transformers/020-causal-mask/",
    excerpt: "Запрещает смотреть <mark>вправо</mark>.",
  },
];

const windows: Window[] = [];

function setup(provider: SearchProvider) {
  const window = new Window({ url: "https://example.test/base/" });
  windows.push(window);
  window.document.body.innerHTML = `
    <header><button type="button" data-search-trigger>Поиск</button></header>
  `;
  const factory = vi.fn(() => provider);
  const cleanup = installSearch(factory, window.document as unknown as Document, 1);
  return { window, factory, cleanup };
}

function pick<T extends Element>(window: Window, selector: string): T {
  const element = window.document.querySelector(selector);
  if (!element) throw new Error(`Не найден ${selector}`);
  return element as unknown as T;
}

function shortcut(window: Window, modifier: "meta" | "ctrl" = "meta"): void {
  window.document.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "k",
      metaKey: modifier === "meta",
      ctrlKey: modifier === "ctrl",
      bubbles: true,
    }),
  );
}

function typeQuery(window: Window, query: string): void {
  const input = pick<HTMLInputElement>(window, "[data-search-input]");
  input.value = query;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

async function waitForSearch(window: Window): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
}

afterEach(() => {
  for (const window of windows.splice(0)) window.close();
});

describe("installSearch", () => {
  it("opens on Cmd+K or Ctrl+K and creates the provider only on first open", () => {
    const provider: SearchProvider = { search: vi.fn(async () => []) };
    const { window, factory } = setup(provider);

    expect(factory).not.toHaveBeenCalled();
    shortcut(window, "meta");

    expect(pick<HTMLElement>(window, "[data-search-modal]").hidden).toBe(false);
    expect(pick<HTMLInputElement>(window, "[data-search-input]")).toBe(window.document.activeElement);
    expect(factory).toHaveBeenCalledTimes(1);

    pick<HTMLButtonElement>(window, "[data-search-close]").click();
    shortcut(window, "ctrl");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("debounces input and renders title, lesson and highlighted excerpt", async () => {
    const search = vi.fn(async () => HITS);
    const { window } = setup({ search });
    pick<HTMLButtonElement>(window, "[data-search-trigger]").click();

    typeQuery(window, "softmax");
    expect(search).not.toHaveBeenCalled();
    await waitForSearch(window);

    expect(search).toHaveBeenCalledWith("softmax");
    expect(pick<HTMLElement>(window, "[data-search-results]").textContent).toContain("Softmax");
    expect(pick<HTMLElement>(window, "[data-search-results]").textContent).toContain(
      "Вероятности",
    );
    expect(window.document.querySelector("[data-search-results] mark")?.textContent).toBe(
      "экспоненты",
    );
  });

  it("moves with arrows and activates the selected result on Enter", async () => {
    const { window } = setup({ search: vi.fn(async () => HITS) });
    shortcut(window);
    typeQuery(window, "маска");
    await waitForSearch(window);

    const input = pick<HTMLInputElement>(window, "[data-search-input]");
    const links = [...window.document.querySelectorAll("[data-search-result]")] as unknown as HTMLAnchorElement[];
    let destination = "";
    links[1].addEventListener("click", (event) => {
      event.preventDefault();
      destination = links[1].getAttribute("href") ?? "";
    });

    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(links[1].classList.contains("is-active")).toBe(true);
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(destination).toBe("/base/lesson/transformers/020-causal-mask/");
  });

  it("leaves ordinary result clicks to the link", async () => {
    const { window } = setup({ search: vi.fn(async () => HITS) });
    shortcut(window);
    typeQuery(window, "softmax");
    await waitForSearch(window);

    const link = pick<HTMLAnchorElement>(window, "[data-search-result]");
    let clicked = false;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      clicked = true;
    });
    link.click();

    expect(clicked).toBe(true);
    expect(link.getAttribute("href")).toBe("/base/lesson/probabilities/010-softmax/");
  });

  it("closes on Escape and restores focus to the trigger", () => {
    const { window } = setup({ search: vi.fn(async () => []) });
    const trigger = pick<HTMLButtonElement>(window, "[data-search-trigger]");
    trigger.focus();
    trigger.click();

    window.document.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(pick<HTMLElement>(window, "[data-search-modal]").hidden).toBe(true);
    expect(window.document.activeElement).toBe(trigger);
  });

  it("distinguishes an unavailable index from an empty result", async () => {
    const unavailable = setup({
      search: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    shortcut(unavailable.window);
    typeQuery(unavailable.window, "softmax");
    await waitForSearch(unavailable.window);
    expect(pick<HTMLElement>(unavailable.window, "[data-search-status]").textContent).toBe(
      "Поиск сейчас недоступен",
    );

    const empty = setup({ search: vi.fn(async () => []) });
    shortcut(empty.window);
    typeQuery(empty.window, "несуществующий термин");
    await waitForSearch(empty.window);
    expect(pick<HTMLElement>(empty.window, "[data-search-status]").textContent).toBe(
      "Ничего не найдено",
    );
  });
});
```

- [ ] **Step 2: Прогнать тест и увидеть отсутствующий модуль**

Run: `rtk npx vitest run src/site-search/modal.test.ts`

Expected: FAIL, `Failed to resolve import "./modal"`.

- [ ] **Step 3: Реализовать `src/site-search/modal.ts`**

```ts
import type { SearchHit, SearchProvider } from "./search-provider";

interface SearchModal {
  open(): void;
  destroy(): void;
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Не найден обязательный элемент поиска: ${selector}`);
  return element as T;
}

function createSearchModal(
  provider: SearchProvider,
  document: Document,
  debounceMs: number,
): SearchModal {
  const view = document.defaultView;
  if (!view) throw new Error("Модалке поиска нужен document с окном");

  const overlay = document.createElement("div");
  overlay.className = "search-modal";
  overlay.setAttribute("data-search-modal", "");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "search-title");
  overlay.hidden = true;
  overlay.innerHTML = `<div class="search-dialog">
<div class="search-heading">
<h2 id="search-title">Поиск по курсу</h2>
<button type="button" class="search-close" data-search-close aria-label="Закрыть поиск">×</button>
</div>
<input class="search-input" data-search-input type="search" autocomplete="off" placeholder="Тема, термин или фраза" aria-label="Запрос">
<p class="search-status" data-search-status aria-live="polite">Введите запрос</p>
<ol class="search-results" data-search-results></ol>
</div>`;
  document.body.appendChild(overlay);

  const input = required<HTMLInputElement>(overlay, "[data-search-input]");
  const closeButton = required<HTMLButtonElement>(overlay, "[data-search-close]");
  const status = required<HTMLElement>(overlay, "[data-search-status]");
  const results = required<HTMLOListElement>(overlay, "[data-search-results]");
  let previousFocus: HTMLElement | null = null;
  let timer: number | null = null;
  let generation = 0;
  let selected = -1;

  function resultLinks(): HTMLAnchorElement[] {
    return [...results.querySelectorAll<HTMLAnchorElement>("[data-search-result]")];
  }

  function select(index: number): void {
    const links = resultLinks();
    if (links.length === 0) {
      selected = -1;
      return;
    }

    selected = Math.max(0, Math.min(index, links.length - 1));
    links.forEach((link, position) => {
      const active = position === selected;
      link.classList.toggle("is-active", active);
      link.setAttribute("aria-current", active ? "true" : "false");
    });
  }

  function render(hits: SearchHit[]): void {
    results.replaceChildren();
    for (const hit of hits) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      const title = document.createElement("span");
      const lesson = document.createElement("span");
      const excerpt = document.createElement("span");

      link.className = "search-result";
      link.setAttribute("data-search-result", "");
      link.href = hit.url;
      title.className = "search-result-title";
      title.textContent = hit.title;
      lesson.className = "search-result-lesson";
      lesson.textContent = hit.lesson;
      excerpt.className = "search-result-excerpt";
      // Контракт SearchProvider: excerpt уже экранирован, кроме безопасного mark.
      excerpt.innerHTML = hit.excerpt;
      link.append(title, lesson, excerpt);
      item.appendChild(link);
      results.appendChild(item);
    }

    status.textContent = hits.length === 0 ? "Ничего не найдено" : `Найдено: ${hits.length}`;
    select(0);
  }

  async function run(query: string, current: number): Promise<void> {
    try {
      const hits = await provider.search(query);
      if (current !== generation || overlay.hidden) return;
      render(hits);
    } catch {
      if (current !== generation || overlay.hidden) return;
      results.replaceChildren();
      selected = -1;
      status.textContent = "Поиск сейчас недоступен";
    }
  }

  function queue(): void {
    if (timer !== null) view.clearTimeout(timer);
    const query = input.value.trim();
    const current = ++generation;
    results.replaceChildren();
    selected = -1;

    if (!query) {
      status.textContent = "Введите запрос";
      timer = null;
      return;
    }

    status.textContent = "Ищу…";
    timer = view.setTimeout(() => {
      timer = null;
      void run(query, current);
    }, debounceMs);
  }

  function close(): void {
    if (overlay.hidden) return;
    if (timer !== null) view.clearTimeout(timer);
    timer = null;
    generation += 1;
    overlay.hidden = true;
    document.body.classList.remove("has-search-modal");
    previousFocus?.focus();
  }

  function open(): void {
    previousFocus = document.activeElement as HTMLElement | null;
    overlay.hidden = false;
    document.body.classList.add("has-search-modal");
    input.focus();
  }

  function onInputKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      select(selected + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      select(selected - 1);
    } else if (event.key === "Enter" && selected >= 0) {
      event.preventDefault();
      resultLinks()[selected]?.click();
    }
  }

  function onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && !overlay.hidden) {
      event.preventDefault();
      close();
    }
  }

  function onBackdropClick(event: MouseEvent): void {
    if (event.target === overlay) close();
  }

  input.addEventListener("input", queue);
  input.addEventListener("keydown", onInputKeydown);
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", onBackdropClick);
  document.addEventListener("keydown", onDocumentKeydown);

  return {
    open,
    destroy() {
      if (timer !== null) view.clearTimeout(timer);
      document.removeEventListener("keydown", onDocumentKeydown);
      overlay.remove();
    },
  };
}

export function installSearch(
  providerFactory: () => SearchProvider,
  document: Document = window.document,
  debounceMs = 250,
): () => void {
  const triggers = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-search-trigger]"),
  ];
  let modal: SearchModal | null = null;

  function open(): void {
    if (!modal) modal = createSearchModal(providerFactory(), document, debounceMs);
    modal.open();
  }

  function onShortcut(event: KeyboardEvent): void {
    if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey) || event.altKey) {
      return;
    }
    event.preventDefault();
    open();
  }

  for (const trigger of triggers) trigger.addEventListener("click", open);
  document.addEventListener("keydown", onShortcut);

  return () => {
    for (const trigger of triggers) trigger.removeEventListener("click", open);
    document.removeEventListener("keydown", onShortcut);
    modal?.destroy();
  };
}
```

- [ ] **Step 4: Прогнать тесты модалки**

Run: `rtk npx vitest run src/site-search/modal.test.ts`

Expected: PASS — 6 тестов, включая отдельные сообщения об ошибке и пустой выдаче.

- [ ] **Step 5: Прогнать typecheck и lint новых файлов**

Run: `rtk npx tsc --noEmit`

Expected: PASS.

Run: `rtk npx eslint src/site-search/search-provider.ts src/site-search/pagefind-provider.ts src/site-search/modal.ts src/site-search/modal.test.ts`

Expected: PASS без предупреждений.

- [ ] **Step 6: Коммит**

```bash
rtk git add src/site-search/modal.ts src/site-search/modal.test.ts
rtk git commit -m "feat(search): add keyboard search modal" -- src/site-search/modal.ts src/site-search/modal.test.ts
```

---

### Task 5: Подключить поиск ко всем статическим страницам

**Files:**
- Create: `src/site-search/index.ts`
- Modify: `src/lib/site/render.tsx:60-430`
- Modify: `src/lib/site/render.test.ts:260-290`
- Modify: `scripts/build-site.mts:70-120,250-300`
- Modify: `src/styles/site.css`

**Interfaces:**
- Каждая статическая страница получает маленький `assets/search.js`, но сам `/pagefind/pagefind.js` импортируется только фабрикой при первом открытии.
- Каждая шапка получает видимую кнопку `[data-search-trigger]`; сочетания Cmd+K/Ctrl+K обрабатываются тем же `installSearch`.
- `build-site.mts` всегда создаёт `out/assets/search.js` как IIFE, рядом с `editor.js` и необязательным `auth.js`.

- [ ] **Step 1: Написать падающий тест подключения кнопки и бандла**

Внутри существующего `describe("обвязка страницы")` добавить:

```ts
  it("adds the search trigger and lightweight bundle to every course page", () => {
    const pages = [
      renderStepPage(model(allWritten), 1, { basePath: "/base" }),
      renderLessonIndexPage(model(allWritten), { basePath: "/base" }),
      renderIndexPage([], { basePath: "/base" }),
    ];

    for (const html of pages) {
      expect(html).toContain("data-search-trigger");
      expect(html).toContain('<script src="/base/assets/search.js"></script>');
    }
  });
```

- [ ] **Step 2: Прогнать тест и увидеть отсутствующую кнопку**

Run: `rtk npx vitest run src/lib/site/render.test.ts`

Expected: FAIL, страница не содержит `data-search-trigger`.

- [ ] **Step 3: Добавить общий helper кнопки и всегда подключать search.js**

После `authModules` в `src/lib/site/render.tsx` добавить:

```ts
function renderSearchButton(): string {
  return `<button type="button" class="nav-button search-button" data-search-trigger data-pagefind-ignore aria-haspopup="dialog">
<span>Поиск</span>
<kbd class="search-shortcut" data-search-shortcut aria-hidden="true">⌘K</kbd>
</button>`;
}
```

В `htmlDocument` формировать внешние скрипты так, чтобы search.js был на каждой странице и выполнялся после появления body-разметки:

```ts
  const modules = [`${options.basePath}/assets/search.js`, ...(options.modules ?? [])];
  const scripts = [
    ...modules.map((src) => `<script src="${src}"></script>`),
    ...(options.scripts ?? []).map((code) => `<script>${code}</script>`),
  ].join("\n");
```

- [ ] **Step 4: Вставить кнопку в четыре вида шапок**

Шапка шага становится:

```ts
  const page = `<header class="step-header" data-pagefind-ignore>
<a class="back" data-pagefind-meta="lesson" href="${lessonUrl(options.basePath, model.slug)}">← ${escapeHtml(model.title)}</a>
<span class="step-header-actions">
<span class="counter" data-counter>${block.number} / ${model.plannedCount}</span>
${renderSearchButton()}
</span>
</header>
```

Начало шапки оглавления урока:

```ts
  const page = `<header class="lesson-header">
<div class="header-toolbar">
<a class="back" href="${options.basePath}/">← к списку уроков</a>
${renderSearchButton()}
</div>
<h1>${escapeHtml(model.title)}</h1>
```

Body главной страницы:

```ts
    body: `<header class="index-header">
<div class="header-toolbar">
<h1>${SITE_TITLE}</h1>
${renderSearchButton()}
</div>
</header>
${sections}`,
```

Body страницы входа:

```ts
    body: `<header class="index-header">
<div class="header-toolbar">
<h1>Вход</h1>
${renderSearchButton()}
</div>
</header>
<main class="lesson">
<p class="run-status" data-auth-status>Проверяю вход…</p>
<a class="nav-button" data-auth-back href="${options.basePath}/">К курсу</a>
</main>`,
```

- [ ] **Step 5: Создать браузерную точку входа `src/site-search/index.ts`**

```ts
import { installSearch } from "./modal";
import { PagefindProvider } from "./pagefind-provider";

const basePath = document.body.getAttribute("data-base") ?? "";
const shortcut = document.querySelector<HTMLElement>("[data-search-shortcut]");

if (shortcut && !/Mac|iPhone|iPad|iPod/.test(navigator.platform)) {
  shortcut.textContent = "Ctrl K";
}

// Фабрика, а не готовый объект: конструктор провайдера начинает import
// Pagefind, поэтому вызывать его можно только в ответ на первое открытие.
installSearch(() => new PagefindProvider(basePath));
```

- [ ] **Step 6: Научить `scripts/build-site.mts` собирать search.js**

После `buildEditor` добавить:

```ts
/** Оболочка поиска без самого индекса: Pagefind она импортирует при открытии. */
async function buildSearch(): Promise<void> {
  await build({
    entryPoints: [path.join(root, "src", "site-search", "index.ts")],
    outfile: path.join(outDir, "assets", "search.js"),
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2020",
    logLevel: "warning",
  });
}
```

В конце `main`, рядом с `await buildEditor()`, вызвать обе независимые сборки:

```ts
  await Promise.all([buildEditor(), buildSearch()]);
```

Удалить прежний одиночный `await buildEditor();`.

- [ ] **Step 7: Добавить адаптивные стили в конец `src/styles/site.css`**

```css
/* Поиск */

.header-toolbar,
.step-header-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}

.header-toolbar .back,
.header-toolbar h1 {
  margin-bottom: 0;
}

.step-header-actions {
  flex: none;
}

.search-button {
  display: inline-flex;
  gap: 0.55rem;
  align-items: center;
  padding-block: 0.35rem;
}

.search-shortcut {
  padding: 0.05rem 0.35rem;
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  border-radius: 0.3rem;
  font: inherit;
  font-size: 0.75rem;
  opacity: 0.6;
}

body.has-search-modal {
  overflow: hidden;
}

.search-modal[hidden] {
  display: none;
}

.search-modal {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: grid;
  align-items: start;
  justify-items: center;
  padding: min(12vh, 6rem) 1rem 1rem;
  overflow-y: auto;
  background: rgb(0 0 0 / 0.48);
}

.search-dialog {
  width: min(42rem, 100%);
  max-height: calc(100vh - min(12vh, 6rem) - 2rem);
  padding: 1rem;
  overflow-y: auto;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: 0.75rem;
  background: var(--background);
  box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 0.28);
}

.search-heading {
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
}

.search-heading h2 {
  margin: 0;
  font-size: 1.15rem;
}

.search-close {
  padding: 0.1rem 0.45rem;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.6;
}

.search-input {
  width: 100%;
  margin-top: 0.8rem;
  padding: 0.65rem 0.8rem;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 0.5rem;
  background: color-mix(in srgb, currentColor 4%, var(--background));
  color: inherit;
  font: inherit;
}

.search-input:focus {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

.search-status {
  margin: 0.65rem 0;
  font-size: 0.85rem;
  opacity: 0.62;
}

.search-results {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.search-result {
  display: grid;
  padding: 0.65rem 0.75rem;
  border-radius: 0.5rem;
  text-decoration: none;
}

.search-result:hover,
.search-result.is-active {
  background: color-mix(in srgb, currentColor 8%, transparent);
}

.search-result-title {
  font-weight: 600;
  line-height: 1.35;
}

.search-result-lesson {
  font-size: 0.8rem;
  opacity: 0.58;
}

.search-result-excerpt {
  margin-top: 0.25rem;
  font-size: 0.9rem;
  line-height: 1.45;
  opacity: 0.82;
}

.search-result-excerpt mark {
  padding-inline: 0.1em;
  background: #fde68a;
  color: #171717;
}

@media (max-width: 32rem) {
  .search-shortcut {
    display: none;
  }

  .step-header-actions {
    gap: 0.4rem;
  }

  .search-modal {
    padding: 0.5rem;
  }

  .search-dialog {
    max-height: calc(100vh - 1rem);
  }
}
```

- [ ] **Step 8: Прогнать unit-тесты и сборку страниц без индекса**

Run: `rtk npx vitest run src/lib/site/render.test.ts src/site-search/modal.test.ts`

Expected: PASS.

Run: `rtk npm run site:pages`

Expected: PASS; существуют `out/assets/search.js` и `out/index.html`, а `out/index.html` содержит `/ai-course-lab/assets/search.js` и `data-search-trigger`.

- [ ] **Step 9: Коммит**

```bash
rtk git add src/site-search/index.ts src/lib/site/render.tsx src/lib/site/render.test.ts scripts/build-site.mts src/styles/site.css
rtk git commit -m "feat(search): wire search into static pages" -- src/site-search/index.ts src/lib/site/render.tsx src/lib/site/render.test.ts scripts/build-site.mts src/styles/site.css
```

---

### Task 6: Проверить полный индекс и пользовательский сценарий

**Files:**
- Verify only: все файлы Tasks 1–5

**Interfaces:**
- Полный acceptance-path: HTML → `out/` → Pagefind index → runtime import → `SearchHit[]` → модалка → ссылка на страницу шага.
- На этом этапе код не добавляется. Если проверка обнаружила дефект, сначала добавить минимальный regression-test в соответствующий предыдущий test-файл, исправить и сделать отдельный fix-коммит.

- [ ] **Step 1: Прогнать все автоматические проверки**

```bash
rtk npm test
rtk npm run typecheck
rtk npm run lint
```

Expected: все vitest-файлы проходят; TypeScript и ESLint завершаются с кодом 0.

- [ ] **Step 2: Собрать опубликованный вариант с реальным base path**

Run: `rtk npm run site:build`

Expected:

- `build-site.mts` сообщает количество собранных шагов;
- Pagefind индексирует то же множество страниц шага, не главную и не оглавления;
- существуют `out/assets/search.js`, `out/pagefind/pagefind.js`, `out/pagefind/pagefind-entry.json`;
- `out/lesson/01-math-foundations__01-linear-algebra-intuition/052-pytorch-gradient/index.html` содержит `data-pagefind-body`, а `out/lesson/01-math-foundations__01-linear-algebra-intuition/index.html` — `data-pagefind-ignore="all"`.

Проверить файлы командами:

```bash
rtk test -s out/assets/search.js
rtk test -s out/pagefind/pagefind.js
rtk rg -l 'data-pagefind-body' out/lesson --glob 'index.html' | rtk wc -l
rtk rg -l 'data-pagefind-ignore="all"' out/lesson --glob 'index.html' | rtk wc -l
```

Expected: первые две команды завершаются с 0; первое число равно количеству собранных шагов, второе — количеству опубликованных уроков.

- [ ] **Step 3: Поднять `out/` под тем же `/ai-course-lab`, что будет на Pages**

В отдельном терминале из корня worktree:

```bash
course_search_server_root=$(mktemp -d)
rtk ln -s "$PWD/out" "$course_search_server_root/ai-course-lab"
rtk python3 -m http.server 4173 --directory "$course_search_server_root"
```

Expected: <http://127.0.0.1:4173/ai-course-lab/> открывает каталог курса; Network не показывает 404 для `assets/search.js`. Временный каталог можно оставить ОС: он не находится внутри репозитория.

- [ ] **Step 4: Проверить управление модалкой**

На desktop выполнить по порядку:

1. Нажать видимую кнопку «Поиск» — модалка открылась, фокус в поле.
2. Закрыть крестиком, нажать Cmd+K на macOS или Ctrl+K на другой ОС — модалка снова открылась.
3. До первого открытия убедиться, что в Network нет запросов к `/pagefind/`; открыть модалку — загружаются `pagefind.js`, WASM и metadata, затем ввести `softmax` — подгружаются нужные shards.
4. Нажать ArrowDown — активная строка смещается; Enter открывает выбранную страницу шага.
5. Вернуться, открыть поиск, кликнуть другой результат — открывается его страница шага.
6. Нажать Escape — модалка закрывается, фокус возвращается на кнопку.

Expected: каждый пункт выполняется без ошибок в Console; адрес результата начинается с `/ai-course-lab/lesson/`, то есть `basePath` не потерян.

- [ ] **Step 5: Проверить десять запросов по разным частям курса**

Для каждого запроса убедиться, что есть осмысленный фрагмент с `<mark>`, показаны название шага и урока, а ссылка открывает именно этот шаг:

| Запрос | Один из ожидаемых адресов |
|---|---|
| `каузальная маска` | `/ai-course-lab/lesson/10-llms-from-scratch__04-pre-training-mini-gpt/032-polnaya-model/` |
| `softmax` | `/ai-course-lab/lesson/19-capstone-projects__34-transformer-block/005-attention/` |
| `градиент` | `/ai-course-lab/lesson/01-math-foundations__18-convex-optimization/034-newton-vs-gd/` |
| `attention` | `/ai-course-lab/lesson/06-speech-and-audio__05-whisper-architecture-finetuning/012-dekoder-cross-attention/` |
| `RAG` | `/ai-course-lab/lesson/01-math-foundations__01-linear-algebra-intuition/020-cosine-v-poiske/` |
| `LoRA` | `/ai-course-lab/lesson/08-generative-ai__08-controlnet-lora-conditioning/014-uzkoe-gorlo/` |
| `токенизация` | `/ai-course-lab/lesson/05-nlp-foundations-to-advanced__07-pos-tagging-parsing/008-syntax-tree/` |
| `косинусное сходство` | `/ai-course-lab/lesson/05-nlp-foundations-to-advanced__18-multilingual-nlp/018-cross-search/` |
| `нормализация` | `/ai-course-lab/lesson/03-deep-learning-core__04-activation-functions/060-itogovaya-proverka/` |
| `PyTorch` | `/ai-course-lab/lesson/01-math-foundations__01-linear-algebra-intuition/052-pytorch-gradient/` |

Expected: результат может быть не первым из-за ранжирования, но указанный шаг присутствует в выдаче либо запрос находит другой шаг с прямым вхождением; ни главная, ни оглавление урока не появляются.

- [ ] **Step 6: Проверить пустую выдачу и реальный отказ загрузки**

1. Ввести уникальную строку `zzzz-course-no-result-20260825`.
2. Убедиться, что видно `Ничего не найдено` и старые результаты очищены.
3. В DevTools включить Disable cache и Offline, сделать hard reload, открыть поиск и ввести `softmax`.
4. Убедиться, что видно `Поиск сейчас недоступен`, а не `Ничего не найдено`.
5. Вернуть Network в Online.

Expected: два состояния визуально и текстово различаются.

- [ ] **Step 7: Проверить телефонную ширину**

В responsive mode выставить ширину 375 px:

- кнопка «Поиск» остаётся видимой, подсказка `⌘K` скрыта;
- диалог помещается в viewport и прокручивает длинную выдачу внутри себя;
- клик по результату работает без клавиатуры;
- фон страницы не прокручивается, пока модалка открыта.

Expected: нет горизонтального скролла, обрезанного поля или недоступной кнопки закрытия.

- [ ] **Step 8: Проверить чистоту ветки и историю коммитов**

```bash
rtk git status --short
rtk git log --oneline -5
```

Expected: tracked-файлы чисты; `out/` не показывается; последние коммиты соответствуют Tasks 1–5. Если были regression-fix, они идут отдельными точечными коммитами.
