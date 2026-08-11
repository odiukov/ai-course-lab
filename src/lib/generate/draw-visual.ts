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
 * Чем схема нарисована: корнем `<svg>` в разметке или сборкой в скрипте.
 *
 * Вторая форма — не поблажка. Промпт требует считать геометрию в рантайме и
 * статического корня не требует, поэтому агент с полным правом строит схему
 * через `document.createElementNS(NS, "svg")`, оставляя в разметке пустой
 * контейнер. Строка пространства имён обязательна для createElementNS, так
 * что её присутствие и есть признак «рисовать есть чем».
 */
const DRAWS_SVG = /<svg|http:\/\/www\.w3\.org\/2000\/svg/i;

/**
 * Три проверки, ничего больше: ни разбора HTML, ни исполнения скрипта.
 *
 * Смысл схемы они не проверяют — за это отвечает требование считать
 * координаты одной функцией перевода в prompts/draw-visual.md. Здесь ловится
 * то, что иначе доедет до ученика пустым прямоугольником: файла нет или
 * рисовать нечем.
 *
 * Внешние ссылки браузер и так не загрузит — /api/visual отдаёт схему с
 * `default-src 'none'`. Барьеры разные и оба нужны: CSP не пускает браузер
 * наружу в рантайме, а эта проверка ловит попытку на генерации, чтобы файл
 * с дырой не лёг на диск и не показался учеником битым. Регулярка слабее
 * CSP (мимо неё пройдёт `fetch(...)`, `@import`, `url(https://…)`), и это
 * нормально: последнее слово за заголовком.
 *
 * Возвращает причину отказа или null.
 */
export function validateVisualHtml(html: string): string | null {
  if (!html.trim()) return "агент вернул пустой файл";
  if (!DRAWS_SVG.test(html)) return "в файле нечем рисовать: ни <svg>, ни сборки схемы скриптом";
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
