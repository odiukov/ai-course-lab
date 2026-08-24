import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import type { AgentEvent } from "../agent/events";
import { renderPrompt } from "../agent/prompts";
import { buildClarificationContext } from "../content/clarification-context";
import { buildCoveredContext } from "../content/covered-context";
import type { LessonPlan } from "../content/lesson-plan";
import {
  checkSchema,
  readStep,
  writeStep,
  type CheckQuestion,
  type Step,
  type StepMeta,
} from "../content/step-file";
import type { LessonSource } from "../source/lesson-source";
import { parseExerciseTargets } from "../source/written-functions";
import { drawVisual } from "./draw-visual";
import type { GenerateDeps } from "./plan-lesson";

const MAX_EXCERPT = 6000;

function exerciseCodeForStep(source: LessonSource, meta: StepMeta): string {
  if (!meta.exercise_fn || !source.exercise) return "(этот экран не относится к конкретному шву кода)";
  const file = meta.exercise_file ?? source.exercise.functions.find((item) => item.fn === meta.exercise_fn)?.file;
  if (!file) return "(файл шва не найден)";
  const solution = path.join(source.exercise.dir, "solution", file);
  if (!fs.existsSync(solution)) return "(эталон шва не найден)";
  const code = fs.readFileSync(solution, "utf8");
  const block = parseExerciseTargets(code).find((item) => item.symbol === meta.exercise_fn);
  if (!block) return "(реализация шва не найдена)";
  return code.split("\n").slice(block.startLine - 1, block.endLine).join("\n");
}

// Finds `anchor` at or after `offset`, requiring it to start a line (so a
// heading string can't match inside a code block or a sentence), and skips
// past any mid-line false positive to keep searching.
function locateAnchor(text: string, anchor: string, offset: number): number {
  let idx = text.indexOf(anchor, offset);
  while (idx !== -1 && idx !== 0 && text[idx - 1] !== "\n") {
    idx = text.indexOf(anchor, idx + 1);
  }
  return idx;
}

export function excerptForStep(source: LessonSource, anchor?: string, offset = 0): string {
  if (!anchor) return source.text.slice(0, MAX_EXCERPT);
  const start = locateAnchor(source.text, anchor, offset);
  if (start === -1) return source.text.slice(0, MAX_EXCERPT);
  const level = (/^#+/.exec(anchor.trim())?.[0] ?? "#").length;
  const rest = source.text.slice(start + anchor.length);
  const next = new RegExp(`^#{1,${level}} `, "m").exec(rest);
  const end = next ? start + anchor.length + next.index : source.text.length;
  return source.text.slice(start, Math.min(end, start + MAX_EXCERPT));
}

// Resolves each step's excerpt in plan order: a step's anchor is searched
// for starting where the previous step's anchor was found, so lessons that
// reuse the same heading text (e.g. several "### Пример" sections) resolve
// each step to its OWN occurrence instead of all collapsing onto the first
// one. A step whose anchor isn't found from the cursor onward falls back to
// searching the whole document from the top; if it's not found at all,
// excerptForStep's own head-of-document fallback applies, exactly as before.
export function resolveStepExcerpts(source: LessonSource, steps: StepMeta[]): Map<string, string> {
  const excerpts = new Map<string, string>();
  let cursor = 0;

  for (const meta of steps) {
    const anchor = meta.source_anchor;
    if (!anchor) {
      excerpts.set(meta.id, excerptForStep(source, undefined));
      continue;
    }

    let pos = locateAnchor(source.text, anchor, cursor);
    if (pos === -1) pos = locateAnchor(source.text, anchor, 0);

    excerpts.set(meta.id, excerptForStep(source, anchor, pos === -1 ? 0 : pos));
    if (pos !== -1) cursor = pos + anchor.length;
  }

  return excerpts;
}

const FENCE_OPEN = /^(`{3,})(?:markdown|md)?\s*$/i;

/**
 * Removes a code fence that wraps the WHOLE reply.
 *
 * Agents sometimes answer "here is the markdown" by putting the entire body
 * inside a ```markdown fence; written verbatim, the step then renders as one
 * monospace block instead of prose (020-identity.md and 027-broadcasting.md
 * were committed that way).
 *
 * Deliberately conservative, because a body may legitimately start with a code
 * block: the opening fence must carry no language or `markdown`/`md`, the last
 * line must close it, and the fence lines in between must come in pairs — so
 * a body whose own first and last blocks are fenced code is left alone.
 */
export function stripEnclosingFence(body: string): string {
  const trimmed = body.trim();
  const lines = trimmed.split("\n");
  if (lines.length < 2) return trimmed;

  const open = FENCE_OPEN.exec(lines[0].trim());
  if (!open) return trimmed;
  if (!new RegExp(`^\`{${open[1].length},}$`).test(lines[lines.length - 1].trim())) return trimmed;

  const inner = lines.slice(1, -1);
  const innerFences = inner.filter((line) => /^`{3,}/.test(line.trim())).length;
  if (innerFences % 2 !== 0) return trimmed;

  return inner.join("\n").trim();
}

/**
 * Исходник диаграммы в теле шага.
 *
 * Приложение рисует markdown через react-markdown и ни один из этих языков не
 * исполняет, поэтому блок доезжает до учащегося сырым текстом в рамке кода — и
 * вдобавок вылезает за ширину колонки. Схема шагу и не нужна: её рисует шаг
 * type: visual в отдельный файл.
 *
 * Ловится именно ЗАБОР с языком диаграммы. Блок ```python на code-шаге —
 * законная часть урока и под правило не подпадает.
 */
const DIAGRAM_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*(mermaid|dot|graphviz|plantuml|puml|tikz)\b[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gim;

export function hasDiagramSource(body: string): boolean {
  DIAGRAM_FENCE.lastIndex = 0;
  return DIAGRAM_FENCE.test(body);
}

/**
 * Убирает блоки с исходниками диаграмм, оставляя остальной текст нетронутым.
 *
 * Сеть последней инстанции: правило в промпте — основной рычаг, но пропущенный
 * им блок лучше вырезать, чем показать учащемуся `graph LR` в рамке. Текст без
 * него читается: схема на visual-шаге всё равно есть отдельным файлом.
 */
export function stripDiagramFences(body: string): string {
  return body.replace(DIAGRAM_FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}

const checkListSchema = z.array(checkSchema).min(1);

export interface StepReply {
  /** Вопросы шага-проверки, если агент их прислал и они правильной формы. */
  check?: CheckQuestion[];
  body: string;
}

/**
 * Разбирает ответ агента на шаг.
 *
 * Для всех типов, кроме `check`, это просто тело в markdown. У шага-проверки
 * ответ начинается с frontmatter, в котором лежат вопросы (см. prompts/
 * write-step.md): рисует их приложение из `check`, а не тело шага.
 *
 * `expectCheck` — не украшение: тело шага имеет право начинаться с `---`
 * (горизонтальная линия), и разбирать frontmatter там, где его быть не должно,
 * означало бы иногда съедать начало текста.
 */
export function parseStepReply(reply: string, expectCheck: boolean): StepReply {
  const text = stripEnclosingFence(reply);
  if (!expectCheck || !text.trimStart().startsWith("---")) return { body: text };

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(text.trimStart());
  } catch {
    // Сломанный YAML: тело сохранить всё равно нужно, а вопросов нет — и
    // вызывающий об этом узнает по отсутствию check.
    return { body: text };
  }

  const questions = checkListSchema.safeParse((parsed.data as { check?: unknown }).check);
  return {
    check: questions.success ? questions.data : undefined,
    body: parsed.content.replace(/^\n+/, "").replace(/\s+$/, ""),
  };
}

/**
 * Шаги сразу после текущего — чтобы шаг не забегал в material, который урок
 * разложил на следующие экраны.
 *
 * Только те, что ВПЕРЕДИ. Прошлое приходит отдельно, из buildCoveredContext, и
 * приходит содержимым, а не заголовком: заголовок «Длина вектора» не мешал
 * выводить длину вектора заново, потому что по нему не видно, что там уже
 * выведено.
 *
 * Имя переменной в промпте осталось `neighbours`: она читается из шаблона на
 * каждый вызов, и переименование сломало бы генерацию, запущенную со старым
 * шаблоном в этот же момент.
 */
function upcomingSummary(plan: LessonPlan, index: number): string {
  return (
    plan.steps
      .slice(index + 1, index + 3)
      .map((step) => `- ${step.type}: ${step.title}`)
      .join("\n") || "(это последний шаг урока)"
  );
}

export async function ensureSteps(opts: {
  contentDir: string;
  source: LessonSource;
  plan: LessonPlan;
  fromIndex: number;
  count?: number;
  deps: GenerateDeps;
  onEvent?: (event: AgentEvent) => void;
  /**
   * Начало работы над очередным шагом.
   *
   * Отдельно от `onEvent`, потому что `onEvent` несёт поток текста от агента:
   * его хвост — обрывок фразы посреди формулы, и в строке прогресса он
   * читается как мусор. Здесь же известно, что именно пишется и сколько
   * осталось.
   */
  onStep?: (info: { number: number; total: number; title: string }) => void;
  onVisualError?: (stepId: string, problem: string) => void;
}): Promise<string[]> {
  const { contentDir, source, plan, fromIndex, deps } = opts;
  const onEvent = opts.onEvent ?? (() => {});
  const onStep = opts.onStep ?? (() => {});
  const onVisualError = opts.onVisualError ?? (() => {});
  const count = opts.count ?? 3;
  const window = plan.steps.slice(fromIndex, fromIndex + count);
  const excerpts = resolveStepExcerpts(source, plan.steps);
  const written: string[] = [];
  // Шаги-проверки, у которых так и не получилось добыть вопросы. Такой шаг не
  // пишется совсем: на экране это «Ниже — несколько коротких вопросов» и сразу
  // под ним «Вопросы к этому шагу ещё не написаны», то есть пустой экран, где
  // должна была быть проверка понимания.
  const withoutQuestions: string[] = [];

  for (const [offset, meta] of window.entries()) {
    const excerpt = excerpts.get(meta.id) ?? excerptForStep(source, meta.source_anchor);
    const existing = readStep(contentDir, plan.slug, meta.id);

    // Написанный шаг не переписывается, но схему ему добирают. Провал
    // рисования не оставляет файла, а к написанному шагу цикл раньше не
    // возвращался — и урок оставался без картинки навсегда, вернуть её можно
    // было только удалив шаг руками. drawVisual сам молчит, когда брифа нет
    // или файл уже на месте, так что лишнего вызова агента здесь не будет.
    if (existing) {
      const problem = await drawVisual({
        contentDir,
        slug: plan.slug,
        meta,
        body: existing.body,
        sourceExcerpt: excerpt,
        deps,
        onEvent,
      });
      if (problem) onVisualError(meta.id, problem);
      continue;
    }

    onStep({ number: fromIndex + offset + 1, total: plan.steps.length, title: meta.title });

    const prompt = renderPrompt("write-step", {
      lesson_title: plan.title,
      step_title: meta.title,
      step_type: meta.type,
      neighbours: upcomingSummary(plan, fromIndex + offset),
      covered: buildCoveredContext({
        contentDir,
        slug: plan.slug,
        steps: plan.steps,
        beforeStepId: meta.id,
      }),
      source_excerpt: excerpt,
      exercise_code: exerciseCodeForStep(source, meta),
      clarifications: buildClarificationContext({
        contentDir,
        slug: plan.slug,
        steps: plan.steps,
        beforeStepId: meta.id,
      }),
    });

    // Вопросы приходят frontmatter'ом у обоих типов, которые их показывают.
    // Разбирать его у `quiz` тоже обязательно: иначе блок с вопросами уезжает
    // в тело шага и учащийся видит на итоговом экране сырой YAML.
    const expectCheck = meta.type === "check" || meta.type === "quiz";
    let reply = parseStepReply(await deps.run(prompt, onEvent), expectCheck);

    // Одна повторная попытка: чаще всего агент просто написал тело и забыл про
    // frontmatter, и прямое напоминание это исправляет. Второй промах — уже не
    // случайность, и молча писать пустую проверку нельзя.
    if (expectCheck && !reply.check) {
      onEvent({
        type: "text",
        text: `Шаг ${meta.id}: вопросов в ответе нет, прошу ещё раз`,
      });
      reply = parseStepReply(
        await deps.run(
          `${prompt}\n\nПредыдущая попытка не дала ни одного вопроса: frontmatter с полем check отсутствовал или был не той формы. Начни ответ строкой --- и полем check, как показано выше, и только потом пиши тело шага.`,
          onEvent,
        ),
        true,
      );
    }
    // Провалом это считается только для `check`: там вопросы — весь смысл шага,
    // и без них экран пустой. У `quiz` есть запасной источник — quiz.json
    // курса, — поэтому шаг записывается и без своих вопросов; учащийся получит
    // английские из исходника вместо русских, но не пустой итог урока.
    if (meta.type === "check" && !reply.check) {
      withoutQuestions.push(meta.id);
      continue;
    }

    // Вырезается молча и без повторной попытки: блок с исходником диаграммы
    // всегда лишний — схему шага рисует отдельный файл, — а второй заход к
    // агенту стоил бы минуту ради текста, который и так не нужен.
    const body = hasDiagramSource(reply.body) ? stripDiagramFences(reply.body) : reply.body;

    const step: Step = { ...meta, body };
    if (reply.check) step.check = reply.check;
    writeStep(contentDir, plan.slug, step);
    written.push(meta.id);

    // Схема рисуется после текста, чтобы рисовальщик видел итоговое тело
    // шага, а не только заголовок. Её провал шаг не отменяет: файл шага уже
    // на диске, и без картинки он читается — в отличие от обратного случая.
    const problem = await drawVisual({
      contentDir,
      slug: plan.slug,
      meta,
      // Тело шага, уже освобождённое от frontmatter шага-проверки: рисовальщик
      // должен видеть ровно тот текст, который лёг на диск.
      body: step.body,
      sourceExcerpt: excerpt,
      deps,
      onEvent,
    });
    if (problem) onVisualError(meta.id, problem);
  }

  if (withoutQuestions.length > 0) {
    throw new Error(
      `Не удалось получить вопросы для шагов-проверок: ${withoutQuestions.join(", ")}. ` +
        `Эти шаги не записаны${written.length > 0 ? `; записаны: ${written.join(", ")}` : ""}. Попробуй сгенерировать их ещё раз.`,
    );
  }

  return written;
}
