# Static Site on GitHub Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать содержимое курса (текст шагов, схемы, вопросы) в статический сайт и опубликовать его на GitHub Pages, не трогая локальное приложение и не трогая рабочую копию.

**Architecture:** Node-скрипт `scripts/build-site.mts` читает `content/lessons/*`, рендерит существующий компонент `StepBody` через `react-dom/server` и раскладывает готовый HTML в `out/`. Чистая логика (якоря, модель страницы, вопросы, ссылки на схемы, группировка каталога) живёт в `src/lib/site/*` и покрыта vitest. Публикация — копия `out/` во временный каталог и `git push --force <repo> HEAD:gh-pages`; в каталоге проекта не выполняется ни одной изменяющей git-команды.

**Tech Stack:** TypeScript, Node 22, React 19 + `react-dom/server`, `react-markdown`/`remark-math`/`rehype-katex` (через существующий `StepBody`), vitest, tsx, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-08-13-static-site-github-pages-design.md`

## Global Constraints

- Node v22.20.0, npm-скрипты запускают `.mts` через `tsx`.
- vitest собирает тесты по маске `src/**/*.test.ts` — **тестовый файл всегда `.ts`**, даже если тестируемый модуль `.tsx`.
- Скрипты в `scripts/` импортируют код из `src/` относительным путём с расширением `.js` (пример: `../src/lib/site/anchors.js`). Алиас `@/` в скриптах не работает. Для `.tsx`-модуля тот же приём (`../src/lib/site/render.js`) — `tsx` сопоставляет `.js` с `.tsx`; если резолв не сработает, импортировать без расширения.
- Комментарии в коде — по-русски, как в остальном проекте; объясняют «почему», а не «что».
- **Уроки дописываются параллельно другим агентом.** Запрещены `git stash`, `git checkout`, `git reset`, `git add -A`, `git commit -a`. Коммитить только явно перечисленные пути.
- Префикс адресов: `BASE_PATH`, по умолчанию `/ai-course-lab`.
- Каталог вывода: `out/` (уже в `.gitignore`).
- Репозиторий публикации: `git@github.com:odiukov/ai-course-lab.git` (существует, public, пустой), ветка `gh-pages`.
- Схема высоты: сообщение `lab-visual-height`, высота зажимается в `[160, 5200]` — те же числа, что в `src/components/VisualFrame.tsx`.

---

### Task 1: Общий CSS темы и вынос KaTeX из компонента

Переменные темы и оформление формул нужны и приложению, и статике. Пока они лежат в `src/app/globals.css`, статический сайт может их только скопировать — и разойтись. Второе: `StepBody` тянет `katex/dist/katex.min.css`, а скрипт под `tsx` импортировать `.css` не умеет, поэтому отрендерить компонент вне Next нельзя.

**Files:**
- Create: `src/styles/theme.css`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/StepBody.tsx:3`

**Interfaces:**
- Consumes: ничего.
- Produces: `src/styles/theme.css` — CSS-переменные `--background`, `--foreground`, `--math-display`, `--math-display-bg`, `--math-display-border`, тёмная тема и правила `.lesson-step-body .katex-display` / `.lesson-step-body a[href^="#step-"]`. Импортируется и из `globals.css`, и из будущего `src/styles/site.css`. `StepBody` больше не импортирует CSS — его можно рендерить в обычном Node-процессе.

- [ ] **Step 1: Прочитать текущий `src/app/globals.css`**

Файл менялся и мог измениться ещё раз параллельным агентом. Читать перед правкой обязательно, переписывать целиком — нельзя.

Run: `cat src/app/globals.css`

- [ ] **Step 2: Создать `src/styles/theme.css`**

Переносится ровно то, что общее у приложения и статики. `@theme inline` и `body` остаются в `globals.css`: первое — директива Tailwind, второе на статике своё.

```css
/* Общая тема приложения и статического сайта.
 *
 * Живёт отдельным файлом, потому что импортируется из двух входов:
 * src/app/globals.css (Tailwind, локальное приложение) и src/styles/site.css
 * (обычный CSS, сборка для GitHub Pages). Формулы должны выглядеть одинаково
 * в обоих местах, а для этого правило должно быть одно.
 */

:root {
  --background: #ffffff;
  --foreground: #171717;
  --math-display: #0f766e;
  --math-display-bg: rgb(13 148 136 / 0.06);
  --math-display-border: rgb(13 148 136 / 0.22);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #ededed;
    --math-display: #5eead4;
    --math-display-bg: rgb(45 212 191 / 0.07);
    --math-display-border: rgb(94 234 212 / 0.2);
  }
}

.lesson-step-body .katex-display {
  margin-block: 1.5em;
  padding: 0.85em 1.1em;
  overflow-x: auto;
  color: var(--math-display);
  background: var(--math-display-bg);
  border-left: 3px solid var(--math-display-border);
  border-radius: 0.5rem;
  font-size: 1.12em;
}

/* Ссылка на шаг: в приложении это `?step=N`, на статике — якорь `#step-<id>`.
 * Оформление одно, поэтому и селектор один на оба адреса. */
.lesson-step-body a[href^="?step="],
.lesson-step-body a[href^="#step-"] {
  color: inherit;
  text-decoration-style: dotted;
  text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
  text-underline-offset: 0.2em;
}

.lesson-step-body a[href^="?step="]:hover,
.lesson-step-body a[href^="#step-"]:hover {
  color: var(--math-display);
  text-decoration-color: currentColor;
}
```

- [ ] **Step 3: Убрать перенесённое из `globals.css` и подключить `theme.css`**

Правками через Edit, не переписывая файл целиком. Удалить блоки `:root`, `@media (prefers-color-scheme: dark)`, `.lesson-step-body .katex-display`, `.lesson-step-body a[href^="?step="]` (и его `:hover`). Оставить `@theme inline` и `body`. Добавить импорт третьей строкой:

```css
@import "tailwindcss";
@import "../styles/theme.css";
@plugin "@tailwindcss/typography";
```

- [ ] **Step 4: Перенести импорт KaTeX в `layout.tsx`**

В `src/components/StepBody.tsx` удалить строку `import "katex/dist/katex.min.css";`. В `src/app/layout.tsx` добавить её первой строкой импортов — рядом с `import "./globals.css"`:

```tsx
import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
```

- [ ] **Step 5: Прогнать тесты компонента**

Run: `npx vitest run src/components/StepBody.test.ts`
Expected: PASS — три существующих теста рендера markdown/KaTeX не зависят от CSS.

- [ ] **Step 6: Проверить, что компонент рендерится вне Next**

Это и есть смысл шага 4: до него команда падала с `Unknown file extension ".css"`.

Run:
```bash
npx tsx -e 'import {createElement} from "react";import {renderToStaticMarkup} from "react-dom/server";import {StepBody} from "./src/components/StepBody.js";console.log(renderToStaticMarkup(createElement(StepBody,{body:"текст $x^2$"})).slice(0,80));'
```
Expected: печатается HTML с `<div class="lesson-step-body`, ошибок нет.

- [ ] **Step 7: Коммит**

```bash
git add src/styles/theme.css src/app/globals.css src/app/layout.tsx src/components/StepBody.tsx
git commit -m "refactor(styles): share theme between app and static build" -- src/styles/theme.css src/app/globals.css src/app/layout.tsx src/components/StepBody.tsx
```

---

### Task 2: Проп `hrefForStep` у `StepBody`

Ссылки на шаги приходят из markdown как `#step-N` (человеческий номер). `StepBody` переводит их в адрес ридера `?step=N-1`. Статике нужен якорь того же документа. Разбирать готовый HTML регулярками — лишний конвейер; правильнее дать компоненту сказать, каким должен быть адрес.

**Files:**
- Modify: `src/components/StepBody.tsx`
- Test: `src/components/StepBody.test.ts`

**Interfaces:**
- Consumes: Task 1 (компонент без импорта CSS).
- Produces: `StepBody` принимает необязательный `hrefForStep?: (stepNumber: number) => string`, где `stepNumber` — человеческий номер шага (с единицы). По умолчанию `(n) => \`?step=${n - 1}\`` — поведение приложения не меняется.

- [ ] **Step 1: Написать падающий тест**

Добавить в `src/components/StepBody.test.ts` внутрь существующего `describe("StepBody", …)`:

```ts
  it("uses the supplied href builder for step references", () => {
    const html = renderToStaticMarkup(
      createElement(StepBody, {
        body: "Смотри шаг 31.",
        currentStepNumber: 33,
        hrefForStep: (stepNumber: number) => `#step-0${stepNumber}-integral`,
      }),
    );

    expect(html).toContain('<a href="#step-031-integral">31</a>');
  });
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/components/StepBody.test.ts`
Expected: FAIL — новый тест получает `?step=30`, потому что проп ещё не читается.

- [ ] **Step 3: Реализовать**

В сигнатуре `StepBody` добавить проп и использовать его при построении адреса:

```tsx
export function StepBody({
  body,
  currentStepNumber,
  onStepLink,
  hrefForStep,
}: {
  body: string;
  currentStepNumber?: number;
  onStepLink?: (stepNumber: number) => void;
  // Куда ведёт ссылка на шаг. В ридере это адрес с ?step=, в статической
  // сборке — якорь той же страницы. Строится здесь, а не переписывается
  // потом в готовом HTML: адрес — свойство ссылки, а не текста вокруг неё.
  hrefForStep?: (stepNumber: number) => string;
}) {
```

и в компоненте `a`:

```tsx
            const renderedHref =
              stepNumber === null
                ? href
                : (hrefForStep ?? ((number: number) => `?step=${number - 1}`))(stepNumber);
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run src/components/StepBody.test.ts`
Expected: PASS — и новый тест, и старый `renders lesson-step references as real reader URLs` (поведение по умолчанию не изменилось).

- [ ] **Step 5: Коммит**

```bash
git add src/components/StepBody.tsx src/components/StepBody.test.ts
git commit -m "feat(step-body): let the caller decide where a step link points" -- src/components/StepBody.tsx src/components/StepBody.test.ts
```

---

### Task 3: Якоря шагов

**Files:**
- Create: `src/lib/site/anchors.ts`
- Test: `src/lib/site/anchors.test.ts`

**Interfaces:**
- Consumes: Task 2 (`hrefForStep`).
- Produces:
  - `stepAnchor(stepId: string): string` — `step-<stepId>`.
  - `anchorHrefForStep(stepIds: string[]): (stepNumber: number) => string` — по человеческому номеру шага (с единицы) даёт `#step-<id>`; номер вне плана возвращается как `#step-<номер>`.

- [ ] **Step 1: Написать падающий тест**

Create `src/lib/site/anchors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { anchorHrefForStep, stepAnchor } from "./anchors";

describe("stepAnchor", () => {
  it("builds an anchor from the step id", () => {
    expect(stepAnchor("003-kasatelnaya")).toBe("step-003-kasatelnaya");
  });
});

describe("anchorHrefForStep", () => {
  const href = anchorHrefForStep(["001-problem", "002-proizvodnaya", "003-kasatelnaya"]);

  it("maps a human step number onto that step's anchor", () => {
    expect(href(3)).toBe("#step-003-kasatelnaya");
  });

  it("leaves a number outside the plan alone", () => {
    // Ссылка ведёт в никуда и в приложении — текст вокруг неё от этого
    // не должен ломаться.
    expect(href(99)).toBe("#step-99");
  });

  it("does not treat zero as the last step", () => {
    expect(href(0)).toBe("#step-0");
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/lib/site/anchors.test.ts`
Expected: FAIL — `Cannot find module './anchors'`.

- [ ] **Step 3: Реализовать**

Create `src/lib/site/anchors.ts`:

```ts
/** Якорь шага на странице урока. */
export function stepAnchor(stepId: string): string {
  return `step-${stepId}`;
}

/**
 * Переводчик «номер шага в тексте → якорь на этой же странице».
 *
 * Номера в markdown человеческие, с единицы, а `stepIds` — порядок плана.
 * Номер вне плана отдаётся как есть: такая ссылка не ведёт никуда и в
 * приложении, но текст вокруг неё должен остаться целым.
 */
export function anchorHrefForStep(stepIds: string[]): (stepNumber: number) => string {
  return (stepNumber) => {
    const id = stepIds[stepNumber - 1];
    return id ? `#${stepAnchor(id)}` : `#step-${stepNumber}`;
  };
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run src/lib/site/anchors.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/site/anchors.ts src/lib/site/anchors.test.ts
git commit -m "feat(site): step anchors for the static build" -- src/lib/site/anchors.ts src/lib/site/anchors.test.ts
```

---

### Task 4: Вопросы шага и их сериализация

**Files:**
- Create: `src/lib/site/quiz.ts`
- Test: `src/lib/site/quiz.test.ts`

**Interfaces:**
- Consumes: тип `Step` из `src/lib/content/step-file.ts`.
- Produces:
  - `interface QuizQuestion { question: string; options: string[]; correct: number; explanation: string }`
  - `quizQuestions(step: Step): QuizQuestion[]` — пустой массив, если шаг не спрашивает.
  - `encodeQuizPayload(questions: QuizQuestion[]): string` — JSON для `<script type="application/json">` с экранированными `<` и `&`.

- [ ] **Step 1: Написать падающий тест**

Create `src/lib/site/quiz.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Step } from "../content/step-file";
import { encodeQuizPayload, quizQuestions } from "./quiz";

function step(overrides: Partial<Step> = {}): Step {
  return { id: "010-check", type: "check", title: "Проверка", body: "", ...overrides };
}

describe("quizQuestions", () => {
  it("carries the correct index and the explanation", () => {
    const questions = quizQuestions(
      step({
        check: [
          {
            question: "Наклон x^2 в точке 3?",
            options: ["3", "6", "9"],
            correct: 1,
            explanation: "Производная 2x, при x=3 это 6.",
          },
        ],
      }),
    );

    expect(questions).toEqual([
      {
        question: "Наклон x^2 в точке 3?",
        options: ["3", "6", "9"],
        correct: 1,
        explanation: "Производная 2x, при x=3 это 6.",
      },
    ]);
  });

  it("returns nothing for a step without questions", () => {
    expect(quizQuestions(step({ type: "theory" }))).toEqual([]);
  });
});

describe("encodeQuizPayload", () => {
  it("escapes markup so a question cannot close the script tag", () => {
    const encoded = encodeQuizPayload([
      { question: "Что делает </script> в тексте?", options: ["A", "B"], correct: 0, explanation: "" },
    ]);

    expect(encoded).not.toContain("</script>");
    expect(JSON.parse(encoded)[0].question).toBe("Что делает </script> в тексте?");
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/lib/site/quiz.test.ts`
Expected: FAIL — `Cannot find module './quiz'`.

- [ ] **Step 3: Реализовать**

Create `src/lib/site/quiz.ts`:

```ts
import type { Step } from "../content/step-file";

export interface QuizQuestion {
  question: string;
  options: string[];
  correct: number;
  explanation: string;
}

/**
 * Вопросы шага в форме, которую понимает клиентский скрипт страницы.
 *
 * В отличие от API приложения, верный ответ здесь не прячется: проверять
 * его некому — сервера у статики нет, и вся проверка живёт в браузере.
 */
export function quizQuestions(step: Step): QuizQuestion[] {
  return (step.check ?? []).map((item) => ({
    question: item.question,
    options: item.options,
    correct: item.correct,
    explanation: item.explanation ?? "",
  }));
}

/**
 * JSON для `<script type="application/json">`.
 *
 * `<` и `&` уезжают в escape-последовательности: разбор JSON их вернёт, а
 * разбор HTML до них не доберётся — иначе вопрос, в котором встретится
 * закрывающий тег скрипта, разорвал бы страницу пополам.
 */
export function encodeQuizPayload(questions: QuizQuestion[]): string {
  return JSON.stringify(questions).replace(/</g, "\\u003c").replace(/&/g, "\\u0026");
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run src/lib/site/quiz.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/site/quiz.ts src/lib/site/quiz.test.ts
git commit -m "feat(site): quiz payload for the static build" -- src/lib/site/quiz.ts src/lib/site/quiz.test.ts
```

---

### Task 5: Группировка уроков в каталог

Слаг урока — `NN-фаза__NN-урок`. Главная страница показывает фазы по порядку, внутри — уроки по номеру.

**Files:**
- Create: `src/lib/site/catalog.ts`
- Test: `src/lib/site/catalog.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `interface CatalogLesson { slug: string; title: string; number: number; writtenCount: number; plannedCount: number }`
  - `interface CatalogPhase { number: number; title: string; lessons: CatalogLesson[] }`
  - `groupLessons(lessons: CatalogLesson[]): CatalogPhase[]`

- [ ] **Step 1: Написать падающий тест**

Create `src/lib/site/catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupLessons, type CatalogLesson } from "./catalog";

function lesson(slug: string, number: number): CatalogLesson {
  return { slug, title: "Урок", number, writtenCount: 10, plannedCount: 10 };
}

describe("groupLessons", () => {
  it("groups lessons by phase and orders both levels by number", () => {
    const phases = groupLessons([
      lesson("02-ml-fundamentals__02-linear-regression", 2),
      lesson("01-math-foundations__04-calculus-for-ml", 4),
      lesson("01-math-foundations__01-linear-algebra-intuition", 1),
    ]);

    expect(phases.map((phase) => phase.number)).toEqual([1, 2]);
    expect(phases[0].title).toBe("Math Foundations");
    expect(phases[0].lessons.map((item) => item.number)).toEqual([1, 4]);
  });

  it("drops a slug that does not name a phase and a lesson", () => {
    // Каталог строится по содержимому content/lessons, куда может попасть
    // что угодно: чужая папка не должна ронять главную страницу.
    expect(groupLessons([lesson("scratch", 1)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/lib/site/catalog.test.ts`
Expected: FAIL — `Cannot find module './catalog'`.

- [ ] **Step 3: Реализовать**

Create `src/lib/site/catalog.ts`:

```ts
export interface CatalogLesson {
  slug: string;
  title: string;
  /** Номер урока внутри фазы. */
  number: number;
  writtenCount: number;
  plannedCount: number;
}

export interface CatalogPhase {
  number: number;
  title: string;
  lessons: CatalogLesson[];
}

const SLUG = /^(\d{2})-([^_]+)__(\d{2})-(.+)$/;

function humanize(rest: string): string {
  return rest
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Раскладывает уроки по фазам, читая номер и название фазы из слага.
 *
 * Слаг — единственный источник: `readCatalog` ходит в репозиторий курса,
 * которого у сборки статики может не быть вовсе, а `content/lessons`
 * самодостаточен.
 */
export function groupLessons(lessons: CatalogLesson[]): CatalogPhase[] {
  const phases = new Map<number, CatalogPhase>();

  for (const lesson of lessons) {
    const match = SLUG.exec(lesson.slug);
    if (!match) continue;

    const number = Number(match[1]);
    const phase = phases.get(number) ?? { number, title: humanize(match[2]), lessons: [] };
    phase.lessons.push(lesson);
    phases.set(number, phase);
  }

  return [...phases.values()]
    .sort((a, b) => a.number - b.number)
    .map((phase) => ({
      ...phase,
      lessons: [...phase.lessons].sort((a, b) => a.number - b.number),
    }));
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run src/lib/site/catalog.test.ts`
Expected: PASS (2 теста).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/site/catalog.ts src/lib/site/catalog.test.ts
git commit -m "feat(site): group lessons into phases for the index page" -- src/lib/site/catalog.ts src/lib/site/catalog.test.ts
```

---

### Task 6: Ссылки на схемы

**Files:**
- Create: `src/lib/site/visual-refs.ts`
- Test: `src/lib/site/visual-refs.test.ts`

**Interfaces:**
- Consumes: `resolveVisualPath`, `resolveGeneratedVisualPath` из `src/lib/api/visual-path.ts`; `StepMeta` из `src/lib/content/step-file.ts`.
- Produces:
  - `interface VisualRef { sourcePath: string; outRelPath: string; href: string }` — откуда взять файл, куда положить внутри `out/`, каким адресом сослаться.
  - `collectVisualRefs(options: { steps: StepMeta[]; slug: string; contentDir: string; sourceDir: string; basePath: string }): { refs: VisualRef[]; hrefByStepId: Record<string, string> }`

- [ ] **Step 1: Написать падающий тест**

Create `src/lib/site/visual-refs.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StepMeta } from "../content/step-file";
import { collectVisualRefs } from "./visual-refs";

let root: string;
let contentDir: string;
let sourceDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "visual-refs-"));
  contentDir = path.join(root, "content");
  sourceDir = path.join(root, "source");
  fs.mkdirSync(path.join(contentDir, "lessons", "lesson-a", "visuals"), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, "learning-visuals"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function collect(steps: StepMeta[]) {
  return collectVisualRefs({
    steps,
    slug: "lesson-a",
    contentDir,
    sourceDir,
    basePath: "/ai-course-lab",
  });
}

describe("collectVisualRefs", () => {
  it("puts a course visual and a generated visual in separate places", () => {
    fs.writeFileSync(path.join(sourceDir, "learning-visuals", "lesson-02-shapes.html"), "<html></html>");
    fs.writeFileSync(path.join(contentDir, "lessons", "lesson-a", "visuals", "003-tangent.html"), "<html></html>");

    const { refs, hrefByStepId } = collect([
      { id: "002-course", type: "visual", title: "Из курса", visual: "learning-visuals/lesson-02-shapes.html" },
      { id: "003-tangent", type: "visual", title: "Своя", visual_brief: "касательная" },
    ]);

    expect(hrefByStepId["002-course"]).toBe("/ai-course-lab/visuals/course/lesson-02-shapes.html");
    expect(hrefByStepId["003-tangent"]).toBe("/ai-course-lab/visuals/lesson-a/003-tangent.html");
    expect(refs.map((ref) => ref.outRelPath).sort()).toEqual([
      "visuals/course/lesson-02-shapes.html",
      "visuals/lesson-a/003-tangent.html",
    ]);
  });

  it("skips a visual that is declared but not on disk", () => {
    // Рамка, смонтированная на отсутствующий файл, — пустой прямоугольник
    // посреди урока.
    const { refs, hrefByStepId } = collect([
      { id: "004-missing", type: "visual", title: "Нет файла", visual_brief: "что-нибудь" },
    ]);

    expect(refs).toEqual([]);
    expect(hrefByStepId).toEqual({});
  });

  it("rejects a path that climbs out of learning-visuals", () => {
    fs.writeFileSync(path.join(sourceDir, "secret.html"), "<html></html>");

    const { refs } = collect([
      { id: "005-evil", type: "visual", title: "Побег", visual: "../source/secret.html" },
    ]);

    expect(refs).toEqual([]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/lib/site/visual-refs.test.ts`
Expected: FAIL — `Cannot find module './visual-refs'`.

- [ ] **Step 3: Реализовать**

Create `src/lib/site/visual-refs.ts`:

```ts
import path from "node:path";
import { resolveGeneratedVisualPath, resolveVisualPath } from "../api/visual-path";
import type { StepMeta } from "../content/step-file";

export interface VisualRef {
  /** Файл на диске, откуда схему брать. */
  sourcePath: string;
  /** Куда она ляжет внутри out/. */
  outRelPath: string;
  /** Каким адресом на неё сослаться со страницы урока. */
  href: string;
}

export interface CollectVisualRefsOptions {
  steps: StepMeta[];
  slug: string;
  contentDir: string;
  sourceDir: string;
  basePath: string;
}

/**
 * Какие схемы нужны уроку и куда они переезжают в статической сборке.
 *
 * Два пространства имён вместо одного, как и в /api/visual: пришедшие с
 * курсом схемы адресуются путём внутри source/, свои — парой урок+шаг.
 * Проверки путей те же самые, потому что источник тот же — поле в файле,
 * который написала модель.
 *
 * Схема, заявленная планом, но отсутствующая на диске, молча пропускается:
 * рамка на 404 даёт пустой прямоугольник в середине урока.
 */
export function collectVisualRefs(options: CollectVisualRefsOptions): {
  refs: VisualRef[];
  hrefByStepId: Record<string, string>;
} {
  const { steps, slug, contentDir, sourceDir, basePath } = options;
  const refs: VisualRef[] = [];
  const hrefByStepId: Record<string, string> = {};

  for (const step of steps) {
    let sourcePath: string | null = null;
    let outRelPath: string | null = null;

    if (step.visual) {
      const resolved = resolveVisualPath(sourceDir, step.visual);
      if (resolved.ok) {
        sourcePath = resolved.path;
        outRelPath = `visuals/course/${path.basename(resolved.path)}`;
      }
    } else if (step.visual_brief) {
      const resolved = resolveGeneratedVisualPath(contentDir, slug, step.id);
      if (resolved.ok) {
        sourcePath = resolved.path;
        outRelPath = `visuals/${slug}/${step.id}.html`;
      }
    }

    if (!sourcePath || !outRelPath) continue;

    const href = `${basePath}/${outRelPath}`;
    refs.push({ sourcePath, outRelPath, href });
    hrefByStepId[step.id] = href;
  }

  return { refs, hrefByStepId };
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run src/lib/site/visual-refs.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/site/visual-refs.ts src/lib/site/visual-refs.test.ts
git commit -m "feat(site): collect the visuals a lesson needs" -- src/lib/site/visual-refs.ts src/lib/site/visual-refs.test.ts
```

---

### Task 7: Модель страницы урока

**Files:**
- Create: `src/lib/site/lesson-page.ts`
- Test: `src/lib/site/lesson-page.test.ts`

**Interfaces:**
- Consumes: `Step`/`StepMeta` (`src/lib/content/step-file.ts`), `stepAnchor` (Task 3), `quizQuestions`/`QuizQuestion` (Task 4).
- Produces:
  - `interface LessonBlock { step: Step; number: number; anchor: string; visualHref: string | null; questions: QuizQuestion[]; practiceFn: string | null }`
  - `interface LessonModel { slug: string; title: string; stepIds: string[]; blocks: LessonBlock[]; plannedCount: number; writtenCount: number }`
  - `buildLessonModel(options: { slug: string; title: string; steps: StepMeta[]; written: Record<string, Step>; visualHrefByStepId: Record<string, string> }): LessonModel`

- [ ] **Step 1: Написать падающий тест**

Create `src/lib/site/lesson-page.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Step, StepMeta } from "../content/step-file";
import { buildLessonModel } from "./lesson-page";

const plan: StepMeta[] = [
  { id: "001-a", type: "theory", title: "Первый" },
  { id: "002-b", type: "theory", title: "Второй" },
  { id: "003-c", type: "visual", title: "Третий", visual_brief: "схема" },
  { id: "004-d", type: "code", title: "Четвёртый", exercise_fn: "dot" },
];

function written(ids: string[]): Record<string, Step> {
  return Object.fromEntries(
    ids.map((id) => {
      const meta = plan.find((item) => item.id === id)!;
      return [id, { ...meta, body: `тело ${id}` } as Step];
    }),
  );
}

function build(ids: string[], visuals: Record<string, string> = {}) {
  return buildLessonModel({
    slug: "lesson-a",
    title: "Урок",
    steps: plan,
    written: written(ids),
    visualHrefByStepId: visuals,
  });
}

describe("buildLessonModel", () => {
  it("keeps plan order and numbering when a step in the middle is missing", () => {
    // Дырка в середине — обычное состояние: урок дописывается прямо сейчас.
    // Четвёртый шаг обязан остаться четвёртым, а не подняться на место
    // ненаписанного третьего.
    const model = build(["001-a", "002-b", "004-d"]);

    expect(model.blocks.map((block) => block.step.id)).toEqual(["001-a", "002-b", "004-d"]);
    expect(model.blocks.map((block) => block.number)).toEqual([1, 2, 4]);
    expect(model.writtenCount).toBe(3);
    expect(model.plannedCount).toBe(4);
  });

  it("exposes anchors and the full plan order for step links", () => {
    const model = build(["001-a"]);

    expect(model.blocks[0].anchor).toBe("step-001-a");
    expect(model.stepIds).toEqual(["001-a", "002-b", "003-c", "004-d"]);
  });

  it("mounts a visual only when the file exists", () => {
    const withFile = build(["003-c"], { "003-c": "/base/visuals/lesson-a/003-c.html" });
    const withoutFile = build(["003-c"]);

    expect(withFile.blocks[0].visualHref).toBe("/base/visuals/lesson-a/003-c.html");
    expect(withoutFile.blocks[0].visualHref).toBeNull();
  });

  it("carries the exercise function of a practice step", () => {
    const model = build(["004-d"]);

    expect(model.blocks[0].practiceFn).toBe("dot");
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/lib/site/lesson-page.test.ts`
Expected: FAIL — `Cannot find module './lesson-page'`.

- [ ] **Step 3: Реализовать**

Create `src/lib/site/lesson-page.ts`:

```ts
import type { Step, StepMeta } from "../content/step-file";
import { stepAnchor } from "./anchors";
import { quizQuestions, type QuizQuestion } from "./quiz";

export interface LessonBlock {
  step: Step;
  /** Человеческий номер шага в плане, с единицы. */
  number: number;
  anchor: string;
  visualHref: string | null;
  questions: QuizQuestion[];
  practiceFn: string | null;
}

export interface LessonModel {
  slug: string;
  title: string;
  /** Полный порядок плана — по нему ссылки на шаги находят свои якоря. */
  stepIds: string[];
  blocks: LessonBlock[];
  plannedCount: number;
  writtenCount: number;
}

export interface BuildLessonModelOptions {
  slug: string;
  title: string;
  steps: StepMeta[];
  /** Прочитанные с диска шаги, ключ — id шага плана. */
  written: Record<string, Step>;
  visualHrefByStepId: Record<string, string>;
}

/**
 * Собирает страницу урока из плана и того, что реально написано.
 *
 * Номер блока берётся из позиции в ПЛАНЕ, а не из порядка написанных шагов:
 * урок дописывается параллельно, и ненаписанный шаг посреди плана — норма.
 * Сдвинь нумерацию — и все ссылки «см. шаг N» в соседних шагах начнут
 * показывать не туда.
 *
 * Функция чистая: ничего не читает с диска, всё приходит аргументами.
 */
export function buildLessonModel(options: BuildLessonModelOptions): LessonModel {
  const { slug, title, steps, written, visualHrefByStepId } = options;
  const blocks: LessonBlock[] = [];

  steps.forEach((meta, position) => {
    const step = written[meta.id];
    if (!step) return;

    blocks.push({
      step,
      number: position + 1,
      anchor: stepAnchor(meta.id),
      visualHref: visualHrefByStepId[meta.id] ?? null,
      questions: quizQuestions(step),
      practiceFn: step.exercise_fn ?? null,
    });
  });

  return {
    slug,
    title,
    stepIds: steps.map((meta) => meta.id),
    blocks,
    plannedCount: steps.length,
    writtenCount: blocks.length,
  };
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run src/lib/site/lesson-page.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/site/lesson-page.ts src/lib/site/lesson-page.test.ts
git commit -m "feat(site): lesson page model tolerant of unwritten steps" -- src/lib/site/lesson-page.ts src/lib/site/lesson-page.test.ts
```

---

### Task 8: Рендер HTML и стили сайта

**Files:**
- Create: `src/lib/site/render.tsx`
- Create: `src/lib/site/client.ts`
- Create: `src/styles/site.css`
- Test: `src/lib/site/render.test.ts`

**Interfaces:**
- Consumes: `LessonModel`/`LessonBlock` (Task 7), `anchorHrefForStep` (Task 3), `encodeQuizPayload` (Task 4), `CatalogPhase` (Task 5), `StepBody` с `hrefForStep` (Task 2).
- Produces:
  - `renderLessonPage(model: LessonModel, options: { basePath: string }): string` — полный HTML-документ урока.
  - `renderIndexPage(phases: CatalogPhase[], options: { basePath: string }): string` — полный HTML главной.
  - `QUIZ_SCRIPT`, `FRAME_SCRIPT` (в `client.ts`) — строки клиентских скриптов.

- [ ] **Step 1: Написать падающий тест**

Create `src/lib/site/render.test.ts`:

```ts
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
      model({ "001-a": { ...plan[0], body: "" } as Step }, { "001-a": "/base/visuals/lesson-a/001-a.html" }),
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
            { slug: "01-math__01-a", title: "Первый урок", number: 1, writtenCount: 8, plannedCount: 56 },
          ],
        },
      ],
      { basePath: "/base" },
    );

    expect(html).toContain('href="/base/lesson/01-math__01-a/"');
    expect(html).toContain("Первый урок");
    expect(html).toContain("8");
    expect(html).toContain("56");
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/lib/site/render.test.ts`
Expected: FAIL — `Cannot find module './render'`.

- [ ] **Step 3: Написать клиентские скрипты**

Create `src/lib/site/client.ts`:

```ts
import { HEIGHT_MESSAGE } from "../api/visual-height";

/**
 * Проверка ответов в браузере.
 *
 * Верный вариант лежит рядом в JSON: сервера у статики нет, прятать ответ
 * не от кого и незачем. Ничего не сохраняется — прогресс остаётся свойством
 * локального приложения.
 */
export const QUIZ_SCRIPT = `
document.querySelectorAll("[data-quiz]").forEach(function (root) {
  var source = root.querySelector("[data-quiz-answers]");
  if (!source) return;
  var answers = JSON.parse(source.textContent || "[]");

  root.querySelectorAll("[data-question]").forEach(function (question) {
    var answer = answers[Number(question.getAttribute("data-question"))];
    if (!answer) return;
    var explanation = question.querySelector("[data-explanation]");

    question.querySelectorAll("[data-option]").forEach(function (button) {
      button.addEventListener("click", function () {
        var chosen = Number(button.getAttribute("data-option"));
        question.querySelectorAll("[data-option]").forEach(function (other) {
          other.classList.remove("is-chosen", "is-wrong");
          if (Number(other.getAttribute("data-option")) === answer.correct) {
            other.classList.add("is-correct");
          }
        });
        button.classList.add(chosen === answer.correct ? "is-chosen" : "is-wrong");
        if (explanation && answer.explanation) {
          explanation.textContent = answer.explanation;
          explanation.hidden = false;
        }
      });
    });
  });
});
`;

/**
 * Высота рамки со схемой — по сообщению от самой схемы.
 *
 * Тот же протокол, что в VisualFrame: отправитель сверяется по
 * contentWindow (origin у песочницы обнулён и подделать сверку нельзя),
 * высота зажимается теми же границами.
 */
export const FRAME_SCRIPT = `
window.addEventListener("message", function (event) {
  var data = event.data;
  if (!data || data.type !== ${JSON.stringify(HEIGHT_MESSAGE)}) return;
  var value = Number(data.height);
  if (!isFinite(value)) return;

  var frames = document.querySelectorAll("iframe[data-visual]");
  for (var i = 0; i < frames.length; i += 1) {
    if (frames[i].contentWindow !== event.source) continue;
    frames[i].style.height = Math.min(Math.max(Math.ceil(value), 160), 5200) + "px";
    return;
  }
});
`;
```

- [ ] **Step 4: Написать рендер**

Create `src/lib/site/render.tsx`:

```tsx
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
  const scripts = (options.scripts ?? [])
    .map((code) => `<script>${code}</script>`)
    .join("\n");

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
```

- [ ] **Step 5: Написать `src/styles/site.css`**

```css
/* Стили статического сайта.
 *
 * Обычный CSS, без Tailwind: его автоопределение источников пропускает
 * gitignore-нутый out/, а ради десятка блоков оболочки заводить сканирование
 * и лишнюю зависимость незачем. Переменные темы и оформление формул общие с
 * приложением — они в theme.css.
 */
@import "./theme.css";

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  line-height: 1.65;
}

a {
  color: inherit;
}

.index-header,
.lesson-header {
  max-width: 60rem;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 0;
}

.index-header h1,
.lesson-header h1 {
  font-size: 2rem;
  line-height: 1.2;
}

.back {
  display: inline-block;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  opacity: 0.65;
  text-decoration: none;
}

.back:hover {
  opacity: 1;
}

.note {
  padding: 0.6rem 0.9rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, currentColor 8%, transparent);
  font-size: 0.9rem;
}

/* Каталог */

.phase {
  max-width: 60rem;
  margin: 0 auto;
  padding: 0 1.5rem 2rem;
}

.phase h2 {
  font-size: 1rem;
  font-weight: 500;
  opacity: 0.6;
}

.lessons {
  margin: 0;
  padding: 0;
  list-style: none;
}

.lessons a {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
  padding: 0.4rem 0.6rem;
  border-radius: 0.4rem;
  text-decoration: none;
}

.lessons a:hover {
  background: color-mix(in srgb, currentColor 8%, transparent);
}

.lesson-number {
  min-width: 1.6rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.5;
}

.partial,
.full {
  margin-left: auto;
  font-size: 0.8rem;
  opacity: 0.55;
}

.partial {
  color: #b45309;
  opacity: 0.9;
}

/* Урок */

.lesson-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2rem;
  max-width: 60rem;
  margin: 0 auto;
  padding: 1.5rem;
}

@media (min-width: 60rem) {
  .lesson-layout {
    grid-template-columns: 15rem minmax(0, 1fr);
    max-width: 78rem;
  }

  .toc {
    position: sticky;
    top: 1.5rem;
    align-self: start;
    max-height: calc(100vh - 3rem);
    overflow-y: auto;
  }
}

.toc ol {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.85rem;
}

.toc a {
  display: flex;
  gap: 0.5rem;
  padding: 0.2rem 0.3rem;
  border-radius: 0.3rem;
  text-decoration: none;
  opacity: 0.7;
}

.toc a:hover {
  background: color-mix(in srgb, currentColor 8%, transparent);
  opacity: 1;
}

.toc-number {
  font-variant-numeric: tabular-nums;
  opacity: 0.55;
}

.step {
  padding-block: 1.5rem 2rem;
  border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  scroll-margin-top: 1rem;
}

.step:first-child {
  border-top: none;
}

.step-title {
  display: flex;
  gap: 0.6rem;
  align-items: baseline;
  font-size: 1.35rem;
  line-height: 1.25;
}

.step-number {
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.45;
}

/* Текст шага */

.lesson-step-body {
  max-width: 42rem;
  font-size: 1.05rem;
}

.lesson-step-body h3,
.lesson-step-body h4 {
  margin-block: 1.6em 0.6em;
  line-height: 1.3;
}

.lesson-step-body p,
.lesson-step-body ul,
.lesson-step-body ol {
  margin-block: 0.9em;
}

.lesson-step-body ul,
.lesson-step-body ol {
  padding-left: 1.4em;
}

.lesson-step-body li {
  margin-block: 0.35em;
}

.lesson-step-body code {
  padding: 0.1em 0.35em;
  border-radius: 0.3em;
  background: color-mix(in srgb, currentColor 10%, transparent);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
}

.lesson-step-body pre {
  padding: 0.9em 1.1em;
  overflow-x: auto;
  border-radius: 0.5rem;
  background: color-mix(in srgb, currentColor 8%, transparent);
}

.lesson-step-body pre code {
  padding: 0;
  background: none;
}

.lesson-step-body blockquote {
  margin-inline: 0;
  padding: 0.1em 1.1em;
  border-left: 3px solid color-mix(in srgb, currentColor 25%, transparent);
  opacity: 0.92;
}

.lesson-step-body table {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 0.95em;
}

.lesson-step-body th,
.lesson-step-body td {
  padding: 0.4em 0.7em;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  text-align: left;
}

.lesson-step-body img {
  max-width: 100%;
}

/* Схемы */

.visual {
  display: block;
  width: 100%;
  height: 520px;
  margin-block: 1.5rem;
  border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
  border-radius: 0.5rem;
}

/* Вопросы */

.quiz {
  max-width: 42rem;
  margin-block: 1.5rem;
}

.quiz-questions {
  margin: 0;
  padding: 0;
  list-style: none;
}

.quiz-question + .quiz-question {
  margin-top: 1.5rem;
}

.quiz-prompt {
  margin-bottom: 0.6rem;
  font-weight: 500;
}

.quiz-options {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.4rem;
}

.quiz-options button {
  width: 100%;
  padding: 0.55rem 0.8rem;
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  border-radius: 0.45rem;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.quiz-options button:hover {
  background: color-mix(in srgb, currentColor 7%, transparent);
}

.quiz-options button.is-correct {
  border-color: #10b981;
}

.quiz-options button.is-chosen {
  border-color: #10b981;
  background: rgb(16 185 129 / 0.12);
}

.quiz-options button.is-wrong {
  border-color: #ef4444;
  background: rgb(239 68 68 / 0.12);
}

.quiz-explanation {
  margin-top: 0.6rem;
  font-size: 0.92rem;
  opacity: 0.8;
}

.practice {
  max-width: 42rem;
  padding: 0.6rem 0.9rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, currentColor 8%, transparent);
  font-size: 0.92rem;
}
```

- [ ] **Step 6: Прогнать тесты**

Run: `npx vitest run src/lib/site/render.test.ts`
Expected: PASS (5 тестов).

- [ ] **Step 7: Коммит**

```bash
git add src/lib/site/render.tsx src/lib/site/render.test.ts src/lib/site/client.ts src/styles/site.css
git commit -m "feat(site): render static lesson and index pages" -- src/lib/site/render.tsx src/lib/site/render.test.ts src/lib/site/client.ts src/styles/site.css
```

---

### Task 9: Сборщик `npm run site:build`

**Files:**
- Create: `scripts/build-site.mts`
- Modify: `package.json` (раздел `scripts`)

**Interfaces:**
- Consumes: всё из Task 3–8, плюс `readLessonPlan` (`src/lib/content/lesson-plan.ts`), `readStepsById` (`src/lib/content/step-file.ts`), `withHeightReporter` (`src/lib/api/visual-height.ts`).
- Produces: команда `npm run site:build`, каталог `out/` по форме из спека.

- [ ] **Step 1: Написать скрипт**

Create `scripts/build-site.mts`:

```ts
// Сборка статического сайта курса: текст шагов и схемы, без редактора,
// агента и прогресса.
//
// Запуск: npm run site:build   (BASE_PATH=... переопределяет префикс адресов)
//
// Читает content/lessons на месте и ничего в рабочей копии не меняет: уроки
// дописываются параллельно, и сборка обязана быть просто срезом того, что
// лежит на диске сию секунду.
import fs from "node:fs";
import path from "node:path";
import { withHeightReporter } from "../src/lib/api/visual-height.js";
import { readLessonPlan } from "../src/lib/content/lesson-plan.js";
import { readStepsById } from "../src/lib/content/step-file.js";
import { groupLessons, type CatalogLesson } from "../src/lib/site/catalog.js";
import { buildLessonModel } from "../src/lib/site/lesson-page.js";
import { renderIndexPage, renderLessonPage } from "../src/lib/site/render.js";
import { collectVisualRefs } from "../src/lib/site/visual-refs.js";

const root = process.cwd();
const contentDir = path.join(root, "content");
const sourceDir = path.join(root, "source");
const outDir = path.join(root, "out");
const basePath = (process.env.BASE_PATH ?? "/ai-course-lab").replace(/\/$/, "");

// Та же политика, что шлёт заголовком /api/visual. GitHub Pages произвольные
// заголовки не отдаёт, поэтому запрет едет внутри самого файла схемы.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'";

function write(relPath: string, content: string): void {
  const target = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

/** Подшивает к схеме мерку высоты и политику CSP первым тегом в <head>. */
function prepareVisual(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  const head = html.toLowerCase().indexOf("<head>");
  const withMeta =
    head === -1
      ? `${meta}\n${html}`
      : `${html.slice(0, head + 6)}\n${meta}${html.slice(head + 6)}`;
  return withHeightReporter(withMeta);
}

function copyKatexAssets(): void {
  const katexDir = path.join(root, "node_modules", "katex", "dist");
  fs.mkdirSync(path.join(outDir, "assets", "katex"), { recursive: true });
  fs.copyFileSync(
    path.join(katexDir, "katex.min.css"),
    path.join(outDir, "assets", "katex", "katex.min.css"),
  );
  fs.cpSync(path.join(katexDir, "fonts"), path.join(outDir, "assets", "katex", "fonts"), {
    recursive: true,
  });
}

function buildSiteCss(): string {
  // theme.css собирается в site.css вручную: обычный @import остался бы
  // ссылкой на файл, которого в out/ нет.
  const styles = path.join(root, "src", "styles");
  const site = fs.readFileSync(path.join(styles, "site.css"), "utf8");
  const theme = fs.readFileSync(path.join(styles, "theme.css"), "utf8");
  return site.replace(/@import\s+"\.\/theme\.css";\s*/, `${theme}\n`);
}

function lessonSlugs(): string[] {
  const lessonsDir = path.join(contentDir, "lessons");
  if (!fs.existsSync(lessonsDir)) return [];
  return fs
    .readdirSync(lessonsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function main(): void {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const catalog: CatalogLesson[] = [];
  let renderedSteps = 0;
  let missingSteps = 0;
  let copiedVisuals = 0;
  let skippedLessons = 0;

  for (const slug of lessonSlugs()) {
    let plan;
    try {
      plan = readLessonPlan(contentDir, slug);
    } catch (error) {
      console.warn(`· ${slug}: план не читается, урок пропущен (${(error as Error).message})`);
      skippedLessons += 1;
      continue;
    }
    if (!plan) continue;

    const written = readStepsById(
      contentDir,
      slug,
      plan.steps.map((step) => step.id),
    );
    const { refs, hrefByStepId } = collectVisualRefs({
      steps: plan.steps,
      slug,
      contentDir,
      sourceDir,
      basePath,
    });

    for (const ref of refs) {
      write(ref.outRelPath, prepareVisual(fs.readFileSync(ref.sourcePath, "utf8")));
      copiedVisuals += 1;
    }

    const model = buildLessonModel({
      slug,
      title: plan.title,
      steps: plan.steps,
      written,
      visualHrefByStepId: hrefByStepId,
    });

    write(path.join("lesson", slug, "index.html"), renderLessonPage(model, { basePath }));

    renderedSteps += model.writtenCount;
    missingSteps += model.plannedCount - model.writtenCount;
    catalog.push({
      slug,
      title: plan.title,
      number: Number(/__(\d{2})-/.exec(slug)?.[1] ?? 0),
      writtenCount: model.writtenCount,
      plannedCount: model.plannedCount,
    });
  }

  write("index.html", renderIndexPage(groupLessons(catalog), { basePath }));
  write("assets/site.css", buildSiteCss());
  // Без .nojekyll Pages прогоняет вывод через Jekyll и выбрасывает всё,
  // что начинается с подчёркивания.
  write(".nojekyll", "");
  copyKatexAssets();

  console.log(
    `Собрано: уроков ${catalog.length}, шагов ${renderedSteps}, ` +
      `не написано ${missingSteps}, схем ${copiedVisuals}` +
      (skippedLessons > 0 ? `, пропущено уроков ${skippedLessons}` : ""),
  );
}

main();
```

- [ ] **Step 2: Добавить npm-скрипт**

В `package.json`, в раздел `scripts`, рядом с `import`:

```json
    "site:build": "tsx scripts/build-site.mts",
```

Файл `package.json` менялся параллельно — читать перед правкой и вносить точечным Edit.

- [ ] **Step 3: Запустить сборку**

Run: `npm run site:build`
Expected: печатается сводка вида `Собрано: уроков 44, шагов ~2300, не написано ~95, схем ~200`; ошибок нет.

- [ ] **Step 4: Проверить вывод**

Run:
```bash
ls out; ls out/lesson | head -3; ls out/assets/katex | head
grep -c 'class="step"' out/lesson/01-math-foundations__04-calculus-for-ml/index.html
grep -o 'href="#step-[0-9]*-[a-z-]*"' out/lesson/01-math-foundations__04-calculus-for-ml/index.html | head -3
```
Expected: 60 секций шагов у урока про производные; ссылки на шаги — якоря вида `#step-004-predel`; в `out/assets/katex` лежат `katex.min.css` и каталог `fonts`.

- [ ] **Step 5: Посмотреть глазами**

Run: `npx http-server out -p 8080 --silent &` — либо `python3 -m http.server 8080 --directory out`

Открыть `http://localhost:8080/index.html`. Поскольку `BASE_PATH` по умолчанию `/ai-course-lab`, локально ссылки не сойдутся — для локального просмотра пересобрать с пустым префиксом:

Run: `BASE_PATH= npm run site:build && python3 -m http.server 8080 --directory out`
Expected: каталог открывается, урок читается, формулы набраны KaTeX, схемы показываются и подгоняют высоту, вопросы кликаются и подсвечиваются.

- [ ] **Step 6: Коммит**

```bash
git add scripts/build-site.mts package.json
git commit -m "feat(site): build the static course site into out/" -- scripts/build-site.mts package.json
```

---

### Task 10: Публикация `npm run site:publish`

**Files:**
- Create: `scripts/publish-site.mts`
- Modify: `package.json` (раздел `scripts`)

**Interfaces:**
- Consumes: `out/`, собранный Task 9.
- Produces: команда `npm run site:publish`; ветка `gh-pages` в `git@github.com:odiukov/ai-course-lab.git`; включённый GitHub Pages.

- [ ] **Step 1: Написать скрипт**

Create `scripts/publish-site.mts`:

```ts
// Публикация статического сайта в ветку gh-pages.
//
// Запуск: npm run site:publish
//
// Ни одной изменяющей git-команды в каталоге проекта: параллельно с этим
// уроки дописывает другой процесс, и любой stash/checkout отобрал бы у него
// файлы из-под рук. Поэтому публикация идёт из временного каталога, который
// ничего не знает о репозитории проекта.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = process.env.SITE_REPO ?? "git@github.com:odiukov/ai-course-lab.git";
const BRANCH = "gh-pages";
const outDir = path.join(process.cwd(), "out");

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function main(): void {
  if (!fs.existsSync(path.join(outDir, "index.html"))) {
    console.error("Нет out/index.html — сначала npm run site:build");
    process.exit(1);
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "course-site-"));
  try {
    fs.cpSync(outDir, staging, { recursive: true });

    run("git", ["init", "-q", "-b", BRANCH], staging);
    run("git", ["add", "-A"], staging);
    run(
      "git",
      [
        "-c",
        "user.name=course-site",
        "-c",
        "user.email=course-site@local",
        "commit",
        "-q",
        "-m",
        `site: ${new Date().toISOString()}`,
      ],
      staging,
    );
    // --force: ветка — артефакт сборки, а не журнал. История из одного
    // коммита каждый раз.
    run("git", ["push", "--force", "--quiet", REPO, `HEAD:${BRANCH}`], staging);

    console.log(`Опубликовано в ${REPO} (${BRANCH}).`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

main();
```

- [ ] **Step 2: Добавить npm-скрипт**

В `package.json`:

```json
    "site:publish": "npm run site:build && tsx scripts/publish-site.mts",
```

- [ ] **Step 3: Опубликовать**

Run: `npm run site:publish`
Expected: `Опубликовано в git@github.com:odiukov/ai-course-lab.git (gh-pages).`

- [ ] **Step 4: Проверить, что ветка приехала**

Run: `gh api repos/odiukov/ai-course-lab/branches --jq '.[].name'`
Expected: в списке есть `gh-pages`.

- [ ] **Step 5: Включить Pages**

Сначала посмотреть, не включён ли уже:

Run: `gh api repos/odiukov/ai-course-lab/pages --jq .html_url 2>/dev/null || echo "не включён"`

Если «не включён»:

Run:
```bash
gh api -X POST repos/odiukov/ai-course-lab/pages \
  -f 'source[branch]=gh-pages' -f 'source[path]=/'
```
Expected: ответ с `"html_url": "https://odiukov.github.io/ai-course-lab/"`.

- [ ] **Step 6: Проверить живой сайт**

Первая сборка Pages занимает минуту-две.

Run: `curl -s -o /dev/null -w '%{http_code}\n' https://odiukov.github.io/ai-course-lab/`
Expected: `200`.

Открыть адрес в браузере: каталог, урок, формулы, схемы, вопросы.

- [ ] **Step 7: Коммит**

```bash
git add scripts/publish-site.mts package.json
git commit -m "feat(site): publish the static site to gh-pages" -- scripts/publish-site.mts package.json
```

---

### Task 11: Резервная копия исходников в `main`

Отдельная задача и отдельное решение: в отличие от всего выше, она трогает состояние репозитория проекта. Выполнять **только по явной команде автора** и **только когда параллельная запись уроков закончена или автор подтвердил, что момент подходящий**.

**Files:**
- Modify: git-конфигурация репозитория (remote `origin`)

**Interfaces:**
- Consumes: ничего.
- Produces: ветка `main` в `git@github.com:odiukov/ai-course-lab.git` со всем содержимым репозитория.

- [ ] **Step 1: Подтвердить у автора**

Спросить: сейчас или позже. Причина вопроса — коммит захватит файлы, которые параллельный агент, возможно, дописывает прямо в эту секунду. Ничего не теряется, но в коммит попадёт полуготовый шаг.

- [ ] **Step 2: Показать, что уедет**

Run: `git status --short | head -40; git status --short | wc -l`
Expected: список изменённых и новых файлов; секретов среди них нет — `.env.local`, `data/`, `.cache/` в `.gitignore`.

- [ ] **Step 3: Убедиться, что секретов нет в индексе**

Run: `git check-ignore -v .env.local data .cache`
Expected: все три игнорируются.

- [ ] **Step 4: Завести remote**

Run: `git remote add origin git@github.com:odiukov/ai-course-lab.git && git remote -v`
Expected: `origin` указывает на репозиторий.

- [ ] **Step 5: Закоммитить содержимое**

```bash
git add -A
git commit -m "content(lessons): snapshot of written lessons and app source"
```

- [ ] **Step 6: Отправить**

Run: `git push -u origin main`
Expected: ветка `main` создана в репозитории.

- [ ] **Step 7: Проверить**

Run: `gh api repos/odiukov/ai-course-lab/branches --jq '.[].name'`
Expected: `gh-pages` и `main`.

---

## Проверка целиком

- [ ] **Все тесты проекта**

Run: `npm test`
Expected: PASS. Изменения затронули `StepBody` (новый необязательный проп) и CSS — существующие тесты должны остаться зелёными.

- [ ] **Типы**

Run: `npm run typecheck`
Expected: без ошибок.

- [ ] **Линтер**

Run: `npm run lint`
Expected: без ошибок.
