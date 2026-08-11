# Generated Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Статус:** выполнен, задачи 1-5 закоммичены. Финальная волна ревью изменила
> часть решений после того, как план был написан, — сверяйся со спекой и кодом, а
> не с фрагментами ниже. Разошлись: текст `prompts/draw-visual.md` (задача 3, шаг
> 4), сигнатура `readGeneratedVisualIds` (задача 5, шаг 3), блок `steps:` в
> `api/lesson/[slug]/route.ts` (задача 5, шаг 5), место `SAFE_SEGMENT` (задача 2,
> шаг 6), заголовки ответа `/api/visual` (задача 2, шаг 10).

**Goal:** Шаг, которому нужна схема, а готовой в курсе нет, получает сгенерированный самодостаточный SVG-визуал вместо ASCII-арта, который врал.

**Architecture:** Планировщик помечает такой шаг полем `visual_brief` вместо пути в `visual`. После записи текста шага `ensureSteps` зовёт рисовальщика, тот пишет HTML в `content/lessons/<slug>/visuals/<step-id>.html`. Путь выводится из id шага и в frontmatter не попадает. Раздача — через `/api/visual?lesson=&step=` с теми же проверками на traversal и symlink, что у визуалов из курса. Провал рисования не отменяет шаг.

**Tech Stack:** Next.js 16.3.0 (App Router), React 19.2.8, TypeScript, zod 4, vitest 4, Tailwind v4.

**Спека:** `docs/superpowers/specs/2026-08-10-generated-visuals-design.md`

## Global Constraints

- Тесты, сообщения об ошибках и текст промптов — по-русски, как во всём репо.
- Комментарии объясняют «почему», а не «что». Смотри стиль в `src/lib/api/visual-path.ts` и `src/lib/content/step-file.ts:61-67`.
- Новых зависимостей не добавлять.
- iframe остаётся `sandbox="allow-scripts"`.
- `npm test` целиком зелёный после каждой задачи. Сейчас базлайн — 236 тестов, 28 файлов.
- `npx eslint` без ошибок после каждой задачи.
- **AGENTS.md этого репо:** это не тот Next.js, что в твоих данных. Перед правкой route handler'ов прочитай соответствующий гайд в `node_modules/next/dist/docs/`. Автор плана этот каталог прочитать не смог — доступ был заблокирован, — так что сверься сам, особенно в задаче 2.
- Ветка: `worktree-feat-generated-visuals` в ворктри `/Users/oleksandr/ai-course-lab/.claude/worktrees/feat-generated-visuals`. Работать только там.
- **Осторожно с `src/app/lesson/[slug]/reader.tsx` (задача 5):** в главном чекауте параллельная сессия правит этот же файл. Свои правки держи минимальными и локальными, чтобы merge был простым.

---

### Task 1: Контракт плана — `visual_brief`

**Files:**
- Modify: `src/lib/content/step-file.ts:19-34` (схема метаданных шага)
- Modify: `src/lib/content/lesson-plan.ts:77-82` (блок валидации визуализаций)
- Modify: `prompts/plan-lesson.md:36` (правило 5) и блок примера JSON на строках 45-50
- Test: `src/lib/content/lesson-plan.test.ts`, `src/lib/content/step-file.test.ts`

**Interfaces:**
- Consumes: ничего от других задач.
- Produces: `StepMeta.visual_brief?: string` — непустая строка. Задачи 3, 4 и 5 читают это поле; задача 4 использует его как условие вызова рисовальщика.

- [ ] **Step 1: Написать падающие тесты валидации**

В `src/lib/content/lesson-plan.test.ts` внутрь `describe("validatePlan", ...)` (после теста на строке 59-62) добавить. `VISUAL` — единственная визуализация, которую фикстура отдаёт для урока `01-math-foundations__02-beta`:

```ts
  const VISUAL = "learning-visuals/lesson-02-shapes.html";

  it("принимает visual-шаг с одним только путём", () => {
    const plan = [...GOOD, step({ id: "005-v", type: "visual", visual: VISUAL })];
    expect(validatePlan(plan, SOURCE)).toEqual([]);
  });

  it("принимает visual-шаг с одним только visual_brief", () => {
    const plan = [
      ...GOOD,
      step({ id: "005-v", type: "visual", visual_brief: "Треугольник 3-4-5, катеты 3 и 4 подписаны" }),
    ];
    expect(validatePlan(plan, SOURCE)).toEqual([]);
  });

  it("ругается, когда заданы и visual, и visual_brief", () => {
    const plan = [
      ...GOOD,
      step({ id: "005-v", type: "visual", visual: VISUAL, visual_brief: "то же самое" }),
    ];
    expect(validatePlan(plan, SOURCE).join(" ")).toMatch(/ровно одно/);
  });

  it("ругается на visual-шаг без пути и без брифа", () => {
    const plan = [...GOOD, step({ id: "005-v", type: "visual" })];
    expect(validatePlan(plan, SOURCE).join(" ")).toMatch(/ни visual, ни visual_brief/);
  });

  it("ругается на visual_brief у шага другого типа", () => {
    const plan = [...GOOD, step({ id: "005-t", type: "theory", visual_brief: "схема" })];
    expect(validatePlan(plan, SOURCE).join(" ")).toMatch(/никто не покажет/);
  });
```

В `src/lib/content/step-file.test.ts` добавить:

```ts
it("отклоняет пустой visual_brief", () => {
  const markdown = [
    "---",
    "id: 001-v",
    "type: visual",
    "title: Схема",
    'visual_brief: ""',
    "---",
    "",
    "Текст.",
  ].join("\n");

  expect(() => parseStep(markdown)).toThrow();
});
```

- [ ] **Step 2: Прогнать тесты, убедиться, что падают**

Run: `npx vitest run src/lib/content/lesson-plan.test.ts src/lib/content/step-file.test.ts`

Expected: FAIL. Тесты про `visual_brief` падают на том, что `validatePlan` не возвращает ожидаемых сообщений; тест про пустой бриф падает потому, что `parseStep` не бросает.

- [ ] **Step 3: Добавить поле в схему**

`src/lib/content/step-file.ts`, сразу после строки `visual: z.string().optional(),`:

```ts
  // Заявка на схему, которой в курсе нет: одна фраза о том, что показать.
  // min(1) не для красоты — пустой бриф хуже отсутствующего, потому что
  // запускает рисовальщика без задания.
  visual_brief: z.string().min(1).optional(),
```

- [ ] **Step 4: Расширить валидацию плана**

`src/lib/content/lesson-plan.ts`, заменить блок на строках 77-82 целиком:

```ts
  const visuals = new Set(source.visuals);
  for (const step of steps) {
    if (step.visual && !visuals.has(step.visual)) {
      errors.push(`Шаг ${step.id}: визуализация ${step.visual} не найдена в уроке`);
    }

    if (step.type !== "visual") {
      if (step.visual_brief) {
        errors.push(
          `Шаг ${step.id}: visual_brief у шага типа ${step.type} — такую схему никто не покажет`,
        );
      }
      continue;
    }

    if (step.visual && step.visual_brief) {
      errors.push(`Шаг ${step.id}: заданы и visual, и visual_brief — нужно ровно одно`);
    }
    if (!step.visual && !step.visual_brief) {
      errors.push(`Шаг ${step.id}: у visual-шага нет ни visual, ни visual_brief`);
    }
  }
```

- [ ] **Step 5: Прогнать тесты, убедиться, что зелёные**

Run: `npm test`

Expected: PASS, 236 + 6 = 242 теста.

- [ ] **Step 6: Переписать правило 5 в промпте планировщика**

`prompts/plan-lesson.md`, заменить строку 36 (`5. Поле visual заполняется только путём из списка выше, дословно.`) на:

```
5. Поле visual заполняется только путём из списка выше, дословно.
   Если шагу нужна схема, которой в списке нет — visual не заполняй, а заполни
   visual_brief: одна фраза о том, что схема должна показать, с конкретными
   числами из урока, если они там есть. Схему нарисуют отдельно.
   Задавать visual и visual_brief одновременно нельзя, и visual_brief имеет
   смысл только на шаге type: visual.
```

В блоке примера JSON (строки 45-50) добавить третью строку, чтобы форма поля была видна:

```json
  {"id": "003-dlina", "type": "visual", "title": "Длина вектора", "visual_brief": "вектор [3, 4] как стрелка из (0,0), катеты 3 и 4 подписаны"}
```

- [ ] **Step 7: Коммит**

```bash
git add src/lib/content/step-file.ts src/lib/content/lesson-plan.ts src/lib/content/lesson-plan.test.ts src/lib/content/step-file.test.ts prompts/plan-lesson.md
git commit -m "feat(plan): let a visual step ask for a diagram it has no file for"
```

---

### Task 2: Путь и раздача сгенерированного файла

**Files:**
- Modify: `src/lib/content/paths.ts:3-37` (`LessonPaths` + `lessonPaths`)
- Modify: `src/lib/api/visual-path.ts` (новый резолвер рядом с существующим)
- Modify: `src/app/api/visual/route.ts`
- Test: `src/lib/content/paths.test.ts`, `src/lib/api/visual-path.test.ts`

**Interfaces:**
- Consumes: ничего от задачи 1.
- Produces:
  - `LessonPaths.visualsDir: string` и `LessonPaths.visualFile(id: string): string` — задачи 3 и 5 пишут и читают файл через них.
  - `resolveGeneratedVisualPath(contentDir: string, slug: string, stepId: string): VisualPathResolution` — тот же тип результата, что у существующего `resolveVisualPath`: `{ ok: true; path: string } | { ok: false; reason: "forbidden" | "not-found" }`.

- [ ] **Step 1: Написать падающий тест путей**

В `src/lib/content/paths.test.ts` добавить:

```ts
it("кладёт сгенерированные схемы в visuals рядом со steps", () => {
  const paths = lessonPaths("/content", "01-math-foundations__02-beta");

  expect(paths.visualsDir).toBe(path.join("/content", "lessons", "01-math-foundations__02-beta", "visuals"));
  expect(paths.visualFile("004-dlina")).toBe(path.join(paths.visualsDir, "004-dlina.html"));
});
```

Если `path` в этом файле ещё не импортирован — добавить `import path from "node:path";`.

- [ ] **Step 2: Прогнать, убедиться, что падает**

Run: `npx vitest run src/lib/content/paths.test.ts`

Expected: FAIL — `paths.visualsDir` это `undefined`.

- [ ] **Step 3: Добавить путь**

`src/lib/content/paths.ts` — в интерфейс `LessonPaths` добавить два члена и заполнить их в `lessonPaths`:

```ts
export interface LessonPaths {
  dir: string;
  planFile: string;
  stepsDir: string;
  clarificationsDir: string;
  visualsDir: string;
  stepFile(id: string): string;
  clarificationFile(id: string): string;
  visualFile(id: string): string;
}

export function lessonPaths(contentDir: string, slug: string): LessonPaths {
  const dir = path.join(contentDir, "lessons", slug);
  const stepsDir = path.join(dir, "steps");
  const clarificationsDir = path.join(dir, "clarifications");
  const visualsDir = path.join(dir, "visuals");
  return {
    dir,
    planFile: path.join(dir, "lesson.json"),
    stepsDir,
    clarificationsDir,
    visualsDir,
    stepFile: (id) => path.join(stepsDir, `${id}.md`),
    clarificationFile: (id) => path.join(clarificationsDir, `${id}.md`),
    visualFile: (id) => path.join(visualsDir, `${id}.html`),
  };
}
```

- [ ] **Step 4: Написать падающие тесты резолвера**

В `src/lib/api/visual-path.test.ts` добавить новый `describe` в конец файла. Он строит своё дерево, потому что корень тут `contentDir`, а не `sourceDir`:

```ts
describe("resolveGeneratedVisualPath", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const SLUG = "01-math-foundations__02-beta";

  function makeTree(): { contentDir: string; visualsDir: string } {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-visual-"));
    const visualsDir = path.join(dir, "lessons", SLUG, "visuals");
    fs.mkdirSync(visualsDir, { recursive: true });
    return { contentDir: dir, visualsDir };
  }

  it("пропускает нарисованный шаг", () => {
    const { contentDir, visualsDir } = makeTree();
    fs.writeFileSync(path.join(visualsDir, "004-dlina.html"), "<svg></svg>");

    const result = resolveGeneratedVisualPath(contentDir, SLUG, "004-dlina");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(fs.realpathSync(path.join(visualsDir, "004-dlina.html")));
    }
  });

  it("404, если шаг ещё не нарисован", () => {
    const { contentDir } = makeTree();

    expect(resolveGeneratedVisualPath(contentDir, SLUG, "004-dlina")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it.each(["../../../etc/passwd", "..", "a/b", "a\\b", "."])(
    "отклоняет id шага %s, не доходя до диска",
    (stepId) => {
      const { contentDir } = makeTree();

      expect(resolveGeneratedVisualPath(contentDir, SLUG, stepId)).toEqual({
        ok: false,
        reason: "forbidden",
      });
    },
  );

  it("отклоняет slug с обходом каталога", () => {
    const { contentDir } = makeTree();

    expect(resolveGeneratedVisualPath(contentDir, "../../etc", "004-dlina")).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("отклоняет симлинк, ведущий за пределы visuals", () => {
    const { contentDir, visualsDir } = makeTree();
    const secret = path.join(contentDir, "secret.txt");
    fs.writeFileSync(secret, "тайна");
    fs.symlinkSync(secret, path.join(visualsDir, "004-dlina.html"));

    expect(resolveGeneratedVisualPath(contentDir, SLUG, "004-dlina")).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("отклоняет симлинк на директорию", () => {
    const { contentDir, visualsDir } = makeTree();
    const subdir = path.join(visualsDir, "subdir");
    fs.mkdirSync(subdir);
    fs.symlinkSync(subdir, path.join(visualsDir, "004-dlina.html"));

    expect(resolveGeneratedVisualPath(contentDir, SLUG, "004-dlina")).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
});
```

Импорт в начале файла заменить на `import { resolveGeneratedVisualPath, resolveVisualPath } from "./visual-path";`.

- [ ] **Step 5: Прогнать, убедиться, что падает**

Run: `npx vitest run src/lib/api/visual-path.test.ts`

Expected: FAIL с ошибкой импорта — `resolveGeneratedVisualPath` не существует.

- [ ] **Step 6: Написать резолвер**

`src/lib/api/visual-path.ts` — добавить импорт `import { lessonPaths } from "../content/paths";` и в конец файла:

```ts
// Slug урока и id шага — сегменты имени файла, не пути. Плоский набор
// символов, никаких точек: `..`, `a/b` и `a\b` отсекаются до обращения к
// диску. Проверка не косметическая — план это сгенерированный файл, который
// написала модель, так что `../../../etc/passwd` в поле id — реалистичный
// вход, а lessonPaths послушно соберёт из него путь.
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * То же, что resolveVisualPath, но для схем, которые проект нарисовал сам:
 * они лежат в `<contentDir>/lessons/<slug>/visuals/<stepId>.html`.
 *
 * Проверки повторяются полностью, а не сокращаются на «путь же собран нами»:
 * симлинк внутри visuals/ ведёт куда угодно, а fs.readFileSync его пройдёт.
 * Поэтому после existsSync оба конца канонизируются через realpathSync, и
 * containment, расширение и «это обычный файл» перепроверяются на
 * канонических путях.
 */
export function resolveGeneratedVisualPath(
  contentDir: string,
  slug: string,
  stepId: string,
): VisualPathResolution {
  if (!SAFE_SEGMENT.test(slug) || !SAFE_SEGMENT.test(stepId)) {
    return { ok: false, reason: "forbidden" };
  }

  const paths = lessonPaths(contentDir, slug);
  const root = paths.visualsDir;
  const target = paths.visualFile(stepId);

  if (!isContained(root, target) || !target.endsWith(".html")) {
    return { ok: false, reason: "forbidden" };
  }
  if (!fs.existsSync(target)) {
    return { ok: false, reason: "not-found" };
  }

  const canonicalRoot = fs.realpathSync(root);
  const canonicalTarget = fs.realpathSync(target);
  if (
    !isContained(canonicalRoot, canonicalTarget) ||
    !canonicalTarget.endsWith(".html") ||
    !fs.statSync(canonicalTarget).isFile()
  ) {
    return { ok: false, reason: "forbidden" };
  }

  return { ok: true, path: canonicalTarget };
}
```

- [ ] **Step 7: Прогнать, убедиться, что зелёные**

Run: `npx vitest run src/lib/api/visual-path.test.ts src/lib/content/paths.test.ts`

Expected: PASS.

- [ ] **Step 8: Написать падающий тест роута**

Создать `src/app/api/visual/route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GET } from "./route";

// Ветка адресации: `lesson`+`step` уходят в резолвер сгенерированных схем,
// одинокий `lesson` или `step` — ошибка запроса, а не поиск по `path`.
// Успешный путь тут не проверить: он требует урока на диске в contentDir.
function get(query: string): Request {
  return new Request(`http://localhost/api/visual?${query}`);
}

describe("GET /api/visual — адресация", () => {
  it("404 на пару lesson+step, которой нет на диске", async () => {
    const response = await GET(get("lesson=01-math-foundations__02-beta&step=004-dlina"));
    expect(response.status).toBe(404);
  });

  it.each(["lesson=01-math-foundations__02-beta", "step=004-dlina"])(
    "400 на неполную пару (%s)",
    async (query) => {
      const response = await GET(get(query));
      expect(response.status).toBe(400);
    },
  );

  it("400 на путь за пределами learning-visuals", async () => {
    const response = await GET(get("path=../secret.html"));
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 9: Прогнать, убедиться, что падает**

Run: `npx vitest run src/app/api/visual/route.test.ts`

Expected: FAIL — на пару `lesson`+`step` роут сейчас идёт в `resolveVisualPath` с пустым `path` и отвечает 400, а не 404.

- [ ] **Step 10: Развести адресацию в роуте**

Сначала прочитай гайд по route handler'ам в `node_modules/next/dist/docs/` — в этом Next.js API может отличаться от привычного.

`src/app/api/visual/route.ts` — заменить целиком:

```ts
import fs from "node:fs";
import { loadConfig } from "@/lib/config";
import {
  resolveGeneratedVisualPath,
  resolveVisualPath,
  type VisualPathResolution,
} from "@/lib/api/visual-path";

// Два пространства имён вместо одного смешанного: `?path=` адресует то, что
// пришло с курсом, `?lesson=&step=` — то, что нарисовали мы. Иначе резолвер
// не смог бы отличить одно от другого по одной строке.
export async function GET(request: Request) {
  const config = loadConfig();
  const params = new URL(request.url).searchParams;
  const lesson = params.get("lesson");
  const step = params.get("step");

  // Аннотация обязательна: без неё `let` выводится в any, и ветка с литералом
  // `{ ok: false }` перестаёт проверяться на совпадение с типом резолвера.
  let resolved: VisualPathResolution;
  if (lesson !== null || step !== null) {
    // Половина пары — ошибка запроса, а не повод искать в source-визуалах:
    // молчаливый откат на `?path=` вернул бы 400 с неверной причиной.
    resolved =
      lesson && step
        ? resolveGeneratedVisualPath(config.contentDir, lesson, step)
        : { ok: false, reason: "forbidden" };
  } else {
    resolved = resolveVisualPath(config.sourceDir, params.get("path") ?? "");
  }

  if (!resolved.ok) {
    return resolved.reason === "not-found"
      ? new Response("Не найдено", { status: 404 })
      : new Response("Запрещённый путь", { status: 400 });
  }

  return new Response(fs.readFileSync(resolved.path, "utf8"), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
```

- [ ] **Step 11: Прогнать всё**

Run: `npm test`

Expected: PASS. Плюс `npx eslint` без ошибок.

- [ ] **Step 12: Коммит**

```bash
git add src/lib/content/paths.ts src/lib/content/paths.test.ts src/lib/api/visual-path.ts src/lib/api/visual-path.test.ts src/app/api/visual/route.ts src/app/api/visual/route.test.ts
git commit -m "feat(visual): serve generated lesson visuals under their own address"
```

---

### Task 3: Рисовальщик

**Files:**
- Create: `prompts/draw-visual.md`
- Create: `src/lib/generate/draw-visual.ts`
- Create: `src/lib/generate/draw-visual.test.ts`
- Modify: `src/lib/agent/prompts.ts:4` (`PromptName`)

**Interfaces:**
- Consumes: `StepMeta.visual_brief` (задача 1); `lessonPaths(...).visualFile(id)` (задача 2); `GenerateDeps` из `src/lib/generate/plan-lesson.ts:10-12` — `{ run: (prompt: string, onEvent: (event: AgentEvent) => void) => Promise<string> }`.
- Produces:
  - `stripHtmlFence(reply: string): string`
  - `validateVisualHtml(html: string): string | null` — причина отказа или `null`, если файл годен.
  - `drawVisual(opts): Promise<string | null>` — `null` при успехе и при no-op, иначе причина, по которой файл не записан. Задача 4 это вызывает.

- [ ] **Step 1: Написать падающие тесты**

Создать `src/lib/generate/draw-visual.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lessonPaths } from "../content/paths";
import type { StepMeta } from "../content/step-file";
import { drawVisual, stripHtmlFence, validateVisualHtml } from "./draw-visual";

const SLUG = "01-math-foundations__02-beta";
const GOOD_HTML = '<!doctype html><html><body><svg viewBox="0 0 10 10"></svg></body></html>';

const META: StepMeta = {
  id: "004-dlina",
  type: "visual",
  title: "Длина вектора",
  visual_brief: "вектор [3, 4] как стрелка из (0,0)",
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "draw-visual-"));
}

function call(contentDir: string, run: ReturnType<typeof vi.fn>, meta: StepMeta = META) {
  return drawVisual({
    contentDir,
    slug: SLUG,
    meta,
    body: "Тело шага про длину вектора.",
    sourceExcerpt: "### Vectors",
    deps: { run },
  });
}

describe("stripHtmlFence", () => {
  it("снимает ```html вокруг всего ответа", () => {
    expect(stripHtmlFence("```html\n<svg></svg>\n```")).toBe("<svg></svg>");
  });

  it("снимает забор без языка", () => {
    expect(stripHtmlFence("```\n<svg></svg>\n```")).toBe("<svg></svg>");
  });

  it("не трогает голый HTML", () => {
    expect(stripHtmlFence("<svg></svg>")).toBe("<svg></svg>");
  });
});

describe("validateVisualHtml", () => {
  it("пропускает самодостаточный SVG", () => {
    expect(validateVisualHtml(GOOD_HTML)).toBeNull();
  });

  it("отклоняет пустой ответ", () => {
    expect(validateVisualHtml("   \n ")).toMatch(/пустой/);
  });

  it("отклоняет файл без svg", () => {
    expect(validateVisualHtml("<html><body><div>схема</div></body></html>")).toMatch(/svg/i);
  });

  it.each([
    '<svg></svg><script src="https://cdn.example.com/d3.js"></script>',
    "<svg></svg><script src='http://cdn.example.com/d3.js'></script>",
    '<svg></svg><link href="//cdn.example.com/x.css" rel="stylesheet">',
  ])("отклоняет внешний ресурс: %s", (html) => {
    expect(validateVisualHtml(html)).toMatch(/внешн/);
  });
});

describe("drawVisual", () => {
  it("пишет файл рядом с шагами", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue(GOOD_HTML);

    expect(await call(contentDir, run)).toBeNull();
    expect(fs.readFileSync(lessonPaths(contentDir, SLUG).visualFile("004-dlina"), "utf8")).toContain("<svg");
  });

  it("кладёт бриф и тело шага в промпт", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue(GOOD_HTML);
    await call(contentDir, run);

    const prompt = run.mock.calls[0][0] as string;
    expect(prompt).toContain("вектор [3, 4] как стрелка из (0,0)");
    expect(prompt).toContain("Тело шага про длину вектора.");
  });

  it("не пишет файл, когда ответ не прошёл проверку", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("<html><body>нет схемы</body></html>");

    expect(await call(contentDir, run)).toMatch(/svg/i);
    expect(fs.existsSync(lessonPaths(contentDir, SLUG).visualFile("004-dlina"))).toBe(false);
  });

  it("не зовёт агента, когда файл уже есть", async () => {
    const contentDir = tmpDir();
    const file = lessonPaths(contentDir, SLUG).visualFile("004-dlina");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, GOOD_HTML);

    const run = vi.fn().mockResolvedValue(GOOD_HTML);
    expect(await call(contentDir, run)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("не зовёт агента для шага без брифа", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue(GOOD_HTML);

    const meta: StepMeta = { id: "005-v", type: "visual", title: "Готовая схема", visual: "learning-visuals/x.html" };
    expect(await call(contentDir, run, meta)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Прогнать, убедиться, что падает**

Run: `npx vitest run src/lib/generate/draw-visual.test.ts`

Expected: FAIL — модуль `./draw-visual` не существует.

- [ ] **Step 3: Зарегистрировать промпт**

`src/lib/agent/prompts.ts:4`:

```ts
export type PromptName = "plan-lesson" | "write-step" | "explain" | "draw-visual";
```

- [ ] **Step 4: Написать промпт рисовальщика**

Создать `prompts/draw-visual.md`. Требование «координаты считаются из данных» — не стилистика: именно ручная расстановка по колонкам и сломала ASCII-схему, которую эта фича заменяет.

```
Ты рисуешь одну схему к экрану учебника. Отвечай только кодом файла.

Шаг: {{step_title}}

Что схема должна показать:
{{visual_brief}}

Текст шага, к которому она идёт:
<body>
{{step_body}}
</body>

Кусок исходного урока:
<source>
{{source_excerpt}}
</source>

Требования к файлу:
- Один самодостаточный HTML-файл: разметка, стили и скрипт внутри него.
  Ни одного обращения наружу — ни CDN, ни шрифтов, ни картинок по ссылке.
- Рисуй в SVG.
- ВСЕ координаты вычисляются из чисел, объявленных в начале скрипта.
  Ни одного числа, вписанного в разметку руками. Если схема про вектор
  [3, 4] — объяви [3, 4] как данные, а положение точек, осей, подписей и
  засечек посчитай формулой от них. Схема, размеченная на глаз, врёт: линия
  не сходится с началом координат, засечка уезжает от подписи.
- Числа на схеме — те же, что в тексте шага. Своих не придумывай.
- Подписи по-русски.
- Тёмная и светлая тема через @media (prefers-color-scheme: dark).
  Фон задай явно: прозрачный фон возьмёт цвет страницы и подписи пропадут.
- Вписывайся в 520 пикселей по высоте и тянись по ширине.
- Никакой интерактивности ради интерактивности. Если ползунок или
  переключатель показывает саму мысль шага — добавь; иначе не добавляй.

Верни только содержимое файла, начиная с <!doctype html>.
Без пояснений до и после.
```

- [ ] **Step 5: Написать модуль**

Создать `src/lib/generate/draw-visual.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import type { AgentEvent } from "../agent/events";
import { renderPrompt } from "../agent/prompts";
import { lessonPaths } from "../content/paths";
import type { StepMeta } from "../content/step-file";
import type { GenerateDeps } from "./plan-lesson";

const FENCE = /^```(?:\w+)?\s*\n([\s\S]*?)\n?```\s*$/;

/** Снимает ```html-забор, если агент обернул в него весь файл. */
export function stripHtmlFence(reply: string): string {
  const trimmed = reply.trim();
  return FENCE.exec(trimmed)?.[1]?.trim() ?? trimmed;
}

// Протокол-относительный `//host` тоже внешний: внутри iframe он разрешится
// в http(s) и уйдёт в сеть.
const EXTERNAL_REF = /(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i;

/**
 * Три проверки, ничего больше: ни разбора HTML, ни исполнения скрипта.
 *
 * Смысл схемы они не проверяют — за это отвечает требование считать
 * координаты из данных в prompts/draw-visual.md. Здесь ловится то, что
 * иначе доедет до ученика пустым прямоугольником: файла нет, рисовать
 * нечем, или страница молча упёрлась в CSP на внешнем ресурсе.
 *
 * Возвращает причину отказа или null.
 */
export function validateVisualHtml(html: string): string | null {
  if (!html.trim()) return "агент вернул пустой файл";
  if (!/<svg/i.test(html)) return "в файле нет <svg>";
  if (EXTERNAL_REF.test(html)) return "файл тянет внешний ресурс";
  return null;
}

/**
 * Рисует схему шага и пишет её в
 * `<contentDir>/lessons/<slug>/visuals/<id шага>.html`.
 *
 * Возвращает null при успехе и когда рисовать не надо (нет брифа, файл уже
 * лежит), иначе — причину, по которой файла не будет. Плохой ответ агента не
 * бросает: шаг без картинки читается, шаг без текста — нет, а текст к этому
 * моменту уже записан.
 *
 * Ошибку самого агента (лимит, CLI не найден) не глотает: она фатальна для
 * всего прогона, и её обрабатывают выше — там же, где ошибку написания шага.
 */
export async function drawVisual(opts: {
  contentDir: string;
  slug: string;
  meta: StepMeta;
  body: string;
  sourceExcerpt: string;
  deps: GenerateDeps;
  onEvent?: (event: AgentEvent) => void;
}): Promise<string | null> {
  const { contentDir, slug, meta, body, sourceExcerpt, deps } = opts;
  if (!meta.visual_brief) return null;

  const file = lessonPaths(contentDir, slug).visualFile(meta.id);
  if (fs.existsSync(file)) return null;

  const prompt = renderPrompt("draw-visual", {
    step_title: meta.title,
    visual_brief: meta.visual_brief,
    step_body: body,
    source_excerpt: sourceExcerpt,
  });

  const html = stripHtmlFence(await deps.run(prompt, opts.onEvent ?? (() => {})));
  const problem = validateVisualHtml(html);
  if (problem) return problem;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html.endsWith("\n") ? html : `${html}\n`, "utf8");
  return null;
}
```

- [ ] **Step 6: Прогнать, убедиться, что зелёные**

Run: `npx vitest run src/lib/generate/draw-visual.test.ts`

Expected: PASS, 14 тестов.

- [ ] **Step 7: Прогнать всё и линт**

Run: `npm test` затем `npx eslint`

Expected: PASS, ошибок линта нет.

- [ ] **Step 8: Коммит**

```bash
git add prompts/draw-visual.md src/lib/generate/draw-visual.ts src/lib/generate/draw-visual.test.ts src/lib/agent/prompts.ts
git commit -m "feat(generate): draw a step's diagram as a self-contained svg file"
```

---

### Task 4: Встройка в генерацию и запрет ASCII

**Files:**
- Modify: `src/lib/generate/write-step.ts:100-140` (`ensureSteps`)
- Modify: `src/app/api/lesson/[slug]/generate/route.ts:49-58`
- Modify: `prompts/write-step.md:19-30` (блок «Правила»)
- Test: `src/lib/generate/write-step.test.ts`

**Interfaces:**
- Consumes: `drawVisual` из задачи 3; `StepMeta.visual_brief` из задачи 1.
- Produces: `ensureSteps` получает необязательный `onVisualError?: (stepId: string, problem: string) => void`. Возвращаемый тип `Promise<string[]>` **не меняется** — на него опираются четыре существующих теста и `generate/route.ts:60`.

- [ ] **Step 1: Написать падающие тесты**

В `src/lib/generate/write-step.test.ts`, внутрь `describe("ensureSteps", ...)`, добавить. Мок различает вызовы по порядку: `ensureSteps` сначала пишет текст, потом рисует, так что первый ответ — тело шага, второй — файл схемы.

```ts
  const VISUAL_PLAN: LessonPlan = {
    ...PLAN,
    steps: [
      {
        id: "001-v",
        type: "visual",
        title: "Длина вектора",
        visual_brief: "вектор [3, 4] как стрелка из (0,0)",
      },
    ],
  };
  const GOOD_SVG = '<!doctype html><html><body><svg viewBox="0 0 10 10"></svg></body></html>';

  it("рисует схему шагу с visual_brief после того, как записал текст", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValueOnce("Тело шага.").mockResolvedValueOnce(GOOD_SVG);

    await ensureSteps({ contentDir, source: SOURCE, plan: VISUAL_PLAN, fromIndex: 0, deps: { run } });

    expect(readStep(contentDir, VISUAL_PLAN.slug, "001-v")?.body).toBe("Тело шага.");
    expect(fs.readFileSync(lessonPaths(contentDir, VISUAL_PLAN.slug).visualFile("001-v"), "utf8")).toContain("<svg");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("рисовальщик видит уже написанное тело шага", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValueOnce("Тело шага.").mockResolvedValueOnce(GOOD_SVG);

    await ensureSteps({ contentDir, source: SOURCE, plan: VISUAL_PLAN, fromIndex: 0, deps: { run } });

    expect(run.mock.calls[1][0] as string).toContain("Тело шага.");
  });

  it("оставляет шаг записанным, когда схема не прошла проверку", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValueOnce("Тело шага.").mockResolvedValueOnce("<html>нет схемы</html>");
    const onVisualError = vi.fn();

    const ids = await ensureSteps({
      contentDir,
      source: SOURCE,
      plan: VISUAL_PLAN,
      fromIndex: 0,
      deps: { run },
      onVisualError,
    });

    expect(ids).toEqual(["001-v"]);
    expect(readStep(contentDir, VISUAL_PLAN.slug, "001-v")?.body).toBe("Тело шага.");
    expect(fs.existsSync(lessonPaths(contentDir, VISUAL_PLAN.slug).visualFile("001-v"))).toBe(false);
    expect(onVisualError).toHaveBeenCalledWith("001-v", expect.stringMatching(/svg/i));
  });

  it("не зовёт рисовальщика для шага с готовой визуализацией из курса", async () => {
    const contentDir = tmpDir();
    const run = vi.fn().mockResolvedValue("Тело шага.");
    const plan: LessonPlan = {
      ...PLAN,
      steps: [{ id: "001-v", type: "visual", title: "Готовая", visual: "learning-visuals/lesson-02-shapes.html" }],
    };

    await ensureSteps({ contentDir, source: SOURCE, plan, fromIndex: 0, deps: { run } });

    expect(run).toHaveBeenCalledTimes(1);
  });
```

В начало файла добавить импорт `import { lessonPaths } from "../content/paths";`.

- [ ] **Step 2: Прогнать, убедиться, что падает**

Run: `npx vitest run src/lib/generate/write-step.test.ts`

Expected: FAIL — `ensureSteps` не знает про `onVisualError`, файл схемы не появляется, `run` вызывается один раз вместо двух.

- [ ] **Step 3: Встроить рисовальщика в ensureSteps**

`src/lib/generate/write-step.ts` — добавить импорт `import { drawVisual } from "./draw-visual";`, в тип `opts` функции `ensureSteps` добавить поле, и после `written.push(meta.id);` вставить вызов:

```ts
export async function ensureSteps(opts: {
  contentDir: string;
  source: LessonSource;
  plan: LessonPlan;
  fromIndex: number;
  count?: number;
  deps: GenerateDeps;
  onEvent?: (event: AgentEvent) => void;
  onVisualError?: (stepId: string, problem: string) => void;
}): Promise<string[]> {
  const { contentDir, source, plan, fromIndex, deps } = opts;
  const onEvent = opts.onEvent ?? (() => {});
  const onVisualError = opts.onVisualError ?? (() => {});
```

Затем в теле цикла (строки 116-137) срез выносится в переменную, чтобы его не считать дважды, и после записи шага вызывается рисовальщик. Тело цикла целиком:

```ts
  for (const [offset, meta] of window.entries()) {
    if (readStep(contentDir, plan.slug, meta.id)) continue;

    const excerpt = excerpts.get(meta.id) ?? excerptForStep(source, meta.source_anchor);

    const prompt = renderPrompt("write-step", {
      lesson_title: plan.title,
      step_title: meta.title,
      step_type: meta.type,
      neighbours: neighbourSummary(plan, fromIndex + offset),
      source_excerpt: excerpt,
      clarifications: buildClarificationContext({
        contentDir,
        slug: plan.slug,
        steps: plan.steps,
        beforeStepId: meta.id,
      }),
    });

    const body = stripEnclosingFence(await deps.run(prompt, onEvent));
    const step: Step = { ...meta, body };
    writeStep(contentDir, plan.slug, step);
    written.push(meta.id);

    // Схема рисуется после текста, чтобы рисовальщик видел итоговое тело
    // шага, а не только заголовок. Её провал шаг не отменяет: файл шага уже
    // на диске, и без картинки он читается — в отличие от обратного случая.
    const problem = await drawVisual({
      contentDir,
      slug: plan.slug,
      meta,
      body,
      sourceExcerpt: excerpt,
      deps,
      onEvent,
    });
    if (problem) onVisualError(meta.id, problem);
  }
```

Условие `if (meta.visual_brief && !meta.visual)` здесь не нужно: `drawVisual` сам возвращает `null` для шага без брифа. Решение принимается в одном месте, а не в двух.

- [ ] **Step 4: Прогнать, убедиться, что зелёные**

Run: `npx vitest run src/lib/generate/write-step.test.ts`

Expected: PASS. Четыре старых теста `ensureSteps` тоже зелёные — их планы не содержат `visual_brief`, так что `drawVisual` возвращает `null`, не тратя вызов агента.

- [ ] **Step 5: Довести провал схемы до ученика**

`src/app/api/lesson/[slug]/generate/route.ts` — в вызов `ensureSteps` добавить:

```ts
      // Не throw: провал схемы не должен рвать поток и отменять уже
      // написанные шаги. sseStream шлёт "error" только из catch, поэтому
      // кадр отправляется здесь руками — ридер уже умеет его показывать и
      // продолжать чтение.
      onVisualError: (stepId, problem) =>
        send("error", { message: `Схему для шага ${stepId} нарисовать не удалось: ${problem}` }),
```

- [ ] **Step 6: Запретить ASCII в промпте писателя**

`prompts/write-step.md` — в блок «Правила» (после строки про формулы) добавить:

```
- Никаких схем из символов: ни ASCII-арта, ни рамок из ─│┼, ни «графиков»
  пробелами. Такая схема размечается по колонкам на глаз и врёт — линия не
  сходится с началом координат, подпись уезжает от засечки. Схему рисует
  отдельный шаг type: visual.
```

- [ ] **Step 7: Прогнать всё и линт**

Run: `npm test` затем `npx eslint`

Expected: PASS, ошибок линта нет.

- [ ] **Step 8: Коммит**

```bash
git add src/lib/generate/write-step.ts src/lib/generate/write-step.test.ts src/app/api/lesson/[slug]/generate/route.ts prompts/write-step.md
git commit -m "feat(generate): draw the step's visual after its text, ban ascii diagrams"
```

---

### Task 5: Показ схемы в ридере

**Files:**
- Create: `src/lib/content/generated-visuals.ts`
- Create: `src/lib/content/generated-visuals.test.ts`
- Modify: `src/app/api/lesson/[slug]/route.ts:20-46`
- Modify: `src/components/VisualFrame.tsx`
- Modify: `src/app/lesson/[slug]/reader.tsx` (интерфейс `StepData` и место рендера `step.visual`)

**Interfaces:**
- Consumes: `lessonPaths(...).visualFile(id)` (задача 2).
- Produces: `readGeneratedVisualIds(contentDir: string, slug: string, ids: string[]): string[]`; в JSON-ответе `/api/lesson/[slug]` у каждого шага появляется `generatedVisual: boolean`, а `visual_brief` из ответа убирается.

- [ ] **Step 1: Написать падающий тест хелпера**

Создать `src/lib/content/generated-visuals.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lessonPaths } from "./paths";
import { readGeneratedVisualIds } from "./generated-visuals";

const SLUG = "01-math-foundations__02-beta";

describe("readGeneratedVisualIds", () => {
  it("возвращает только те шаги, чей файл лежит на диске", () => {
    const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-ids-"));
    const paths = lessonPaths(contentDir, SLUG);
    fs.mkdirSync(paths.visualsDir, { recursive: true });
    fs.writeFileSync(paths.visualFile("002-v"), "<svg></svg>");

    expect(readGeneratedVisualIds(contentDir, SLUG, ["001-t", "002-v", "003-v"])).toEqual(["002-v"]);
  });

  it("пустой список, когда каталога visuals нет", () => {
    const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-ids-"));

    expect(readGeneratedVisualIds(contentDir, SLUG, ["001-t"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Прогнать, убедиться, что падает**

Run: `npx vitest run src/lib/content/generated-visuals.test.ts`

Expected: FAIL — модуля `./generated-visuals` нет.

- [ ] **Step 3: Написать хелпер**

Создать `src/lib/content/generated-visuals.ts`:

```ts
import fs from "node:fs";
import { lessonPaths } from "./paths";

/**
 * Какие из `ids` уже имеют нарисованную схему на диске.
 *
 * Ридеру это нужно, чтобы решить, монтировать ли iframe вообще: шаг, который
 * в плане попросил схему, может её ещё не иметь — не нарисовали или
 * нарисованное не прошло проверку. Смонтированный на 404 iframe — пустой
 * прямоугольник в середине урока.
 */
export function readGeneratedVisualIds(contentDir: string, slug: string, ids: string[]): string[] {
  const paths = lessonPaths(contentDir, slug);
  return ids.filter((id) => fs.existsSync(paths.visualFile(id)));
}
```

- [ ] **Step 4: Прогнать, убедиться, что зелёные**

Run: `npx vitest run src/lib/content/generated-visuals.test.ts`

Expected: PASS.

- [ ] **Step 5: Отдать флаг из API урока**

Сначала сверься с гайдом по route handler'ам в `node_modules/next/dist/docs/`.

`src/app/api/lesson/[slug]/route.ts` — добавить импорт `import { readGeneratedVisualIds } from "@/lib/content/generated-visuals";`, а поле `steps:` в ответе заменить:

```ts
  // visual_brief — задание рисовальщику, ридеру оно не нужно; вместо него
  // едет факт «файл на диске есть». Отбрасывается тем же приёмом, что `body`
  // в serializeStep (step-file.ts:48) — лишняя переменная в деструктуризации
  // здесь не ошибка линта, а сложившийся в репо способ выкинуть поле.
  const drawn = new Set(readGeneratedVisualIds(config.contentDir, slug, Object.keys(steps)));

  return Response.json({
    plan,
    stale: plan ? isStale(plan, source) : false,
    steps: Object.fromEntries(
      Object.entries(steps).map(([id, step]) => {
        const { visual_brief, ...rest } = step;
        return [id, { ...rest, generatedVisual: drawn.has(id) }];
      }),
    ),
```

Остальные поля ответа (`clarifications`, `progress`, `source`) не трогать.

- [ ] **Step 6: Развести адресацию в VisualFrame**

`src/components/VisualFrame.tsx` — заменить целиком. Компонент перестаёт сам собирать URL: адресов теперь два, и знание о том, какой из них нужен, живёт у вызывающего.

```tsx
export function VisualFrame({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      src={src}
      sandbox="allow-scripts"
      className="my-6 h-[520px] w-full rounded-lg border border-slate-200 dark:border-slate-700"
      title={title}
    />
  );
}
```

- [ ] **Step 7: Показать схему в ридере**

`src/app/lesson/[slug]/reader.tsx`:

в интерфейс `StepData` добавить поле:

```ts
  generatedVisual?: boolean;
```

и заменить строку рендера `{step.visual && <VisualFrame path={step.visual} />}` на:

```tsx
      {step.visual && (
        <VisualFrame src={`/api/visual?path=${encodeURIComponent(step.visual)}`} title={step.visual} />
      )}
      {step.generatedVisual && (
        <VisualFrame
          src={`/api/visual?lesson=${encodeURIComponent(slug)}&step=${encodeURIComponent(step.id)}`}
          title={step.title}
        />
      )}
```

- [ ] **Step 8: Прогнать всё и линт**

Run: `npm test` затем `npx eslint`

Expected: PASS, ошибок линта нет. `npx tsc --noEmit` тоже должен быть чистым — `VisualFrame` сменил пропсы, и старый вызов `path=` сломал бы сборку.

- [ ] **Step 9: Проверить в живом приложении**

Автотестов на ридер в проекте нет, поэтому этот шаг обязателен.

```bash
npm run dev
```

Проверить:
1. Открыть урок `01-math-foundations__02-vectors-matrices-operations`, дойти до шага с готовой визуализацией из курса — iframe рисуется, как раньше (регрессия на смену пропсов `VisualFrame`).
2. Проверить, что тёмная тема страницы не сломалась: подписи читаются, кнопка «Дальше» видна.
3. `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/visual?lesson=01-math-foundations__02-vectors-matrices-operations&step=нет-такого"` — ожидается 400 (id не проходит `SAFE_SEGMENT`).
4. `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/visual?lesson=01-math-foundations__02-vectors-matrices-operations&step=004-dlina"` — ожидается 404, пока схема не нарисована.

Сгенерированную схему живьём можно увидеть только прогнав агента на уроке, у которого планировщик выдал `visual_brief`. Это стоит вызовов агента — делать по решению владельца репо, не по умолчанию.

- [ ] **Step 10: Коммит**

```bash
git add src/lib/content/generated-visuals.ts src/lib/content/generated-visuals.test.ts src/app/api/lesson/[slug]/route.ts src/components/VisualFrame.tsx src/app/lesson/[slug]/reader.tsx
git commit -m "feat(reader): show a step's generated visual when it exists on disk"
```

---

## Покрытие спеки

| Раздел спеки | Задача |
|---|---|
| 1. Контракт плана | 1 |
| 2. Точка вызова | 4 |
| 3. Промпт рисовальщика | 3, шаг 4 |
| 4. Хранение и адресация | 2 |
| 5. Валидация файла | 3 |
| 6. Рендер | 5 |
| 7. Запрет ASCII | 4, шаг 6 |
| Тесты | 1, 2, 3, 4, 5 |
