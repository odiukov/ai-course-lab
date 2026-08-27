import { z } from "zod";
import type { AgentEvent } from "../agent/events";
import { renderPrompt } from "../agent/prompts";
import { auditCheck, auditStep, formatFindings, type Finding } from "../cards/audit";
import {
  cardDraftSchema,
  removeCards,
  withFingerprints,
  writeCards,
  type Card,
  type CardDraft,
} from "../cards/card";
import { checkSchema, type CheckQuestion, type Step } from "../content/step-file";
import type { LessonSource, QuizQuestion } from "../source/lesson-source";
import { extractJsonBlock, type GenerateDeps } from "./plan-lesson";
import { exerciseCodeForStep } from "./write-step";

const replySchema = z.object({
  cards: z.array(cardDraftSchema).default([]),
  check: z.array(checkSchema).default([]),
});

export interface StepCardsResult {
  stepId: string;
  cards: Card[];
  check: CheckQuestion[];
  findings: Finding[];
}

/**
 * Разбор ответа агента.
 *
 * Мусор вместо JSON и JSON не той формы обрабатываются одинаково — пустыми
 * списками, а не исключением. Один невнятный ответ посреди прохода по сотням
 * шагов не должен ронять весь прогон: пустые списки означают «карточек нет»,
 * и это видно дальше в findings и в отчёте.
 */
export function parseCardsReply(reply: string): { cards: CardDraft[]; check: CheckQuestion[] } {
  let block: unknown;
  try {
    block = extractJsonBlock(reply);
  } catch {
    return { cards: [], check: [] };
  }
  const parsed = replySchema.safeParse(block);
  return parsed.success ? parsed.data : { cards: [], check: [] };
}

/**
 * Пропажа существующих вопросов шага.
 *
 * Пустой `check` в ответе — законный результат, когда у шага и не было
 * вопросов (промпт прямо запрещает агенту их выдумывать). Но если вопросы
 * БЫЛИ, а вернулся пустой список, это не «нечего чинить» — это агент
 * промолчал вместо починки. Без этой проверки auditCheck([]) не находит
 * нарушений (пустому списку нечем нарушить правила), попытка засчитывается
 * успешной, а на диске остаётся прежний бракованный вопрос — и ни отчёт, ни
 * повтор об этом не узнают.
 */
function checkDropped(step: Step, check: CheckQuestion[]): Finding[] {
  if (!step.check?.length || check.length) return [];
  return [
    {
      ref: step.id,
      rule: "check-dropped",
      severity: "error",
      message:
        `У шага были вопросы check (${step.check.length}), а ответ вернул пустой список — ` +
        "верни их же, но с починенными вопросами, а не выброшенными.",
    },
  ];
}

/**
 * Вопросы исходника курса — как образец предметности, а не как материал.
 *
 * Правильный вариант печатается рядом с вопросом намеренно: без него агент
 * видит только формулировки и не видит, на каком уровне курс ждёт ответ.
 * Дублировать эти вопросы запрещено промптом — их и так задают на quiz-шаге.
 */
function formatSourceQuiz(quiz: QuizQuestion[]): string {
  if (!quiz.length) return "(в исходнике вопросов нет)";
  return quiz
    .map((item) => `- ${item.question}\n  верный ответ: ${item.options[item.correct] ?? "?"}`)
    .join("\n");
}

function buildPrompt(
  lessonTitle: string,
  step: Step,
  source: LessonSource,
  sourceExcerpt: string,
  findings: Finding[],
): string {
  return renderPrompt("write-cards", {
    lesson_title: lessonTitle,
    step_title: step.title,
    step_type: step.type,
    source_excerpt: sourceExcerpt,
    source_quiz: formatSourceQuiz(source.quiz),
    exercise_code: exerciseCodeForStep(source, step),
    step_body: step.body,
    existing_check: step.check?.length ? JSON.stringify(step.check, null, 2) : "(их нет)",
    findings: findings.length ? formatFindings(findings) : "(это первая попытка)",
  });
}

/**
 * Карточки и починенные вопросы одного шага.
 *
 * Один вызов агента выдаёт и то, и другое: чтение шага — самая дорогая часть
 * вызова, и платить за неё дважды незачем.
 *
 * `source` и `sourceExcerpt` обязательны, а не необязательны с запасным
 * вариантом: материал вопроса — исходник курса, и вызов без него молча
 * возвращает нас к тому, ради чего затеяно изменение — к карточкам по нашему
 * же пересказу. Пусть лучше не соберётся типами.
 *
 * Повтор ровно один. Замечания первой попытки уходят агенту вместе с исходным
 * заданием; если и вторая попытка не прошла аудит, на диск не пишется ничего,
 * а шаг попадает в отчёт человеку. Писать забракованное «пока так» нельзя:
 * карточка уедет в график повторений и будет учить не тому.
 */
export async function writeCardsForStep(opts: {
  contentDir: string;
  slug: string;
  step: Step;
  source: LessonSource;
  /** Срез исходника по `source_anchor` шага — что именно этот шаг покрывает. */
  sourceExcerpt: string;
  deps: GenerateDeps;
  lessonTitle?: string;
  onEvent?: (event: AgentEvent) => void;
}): Promise<StepCardsResult> {
  const { contentDir, slug, step, source, sourceExcerpt, deps } = opts;
  const lessonTitle = opts.lessonTitle ?? slug;
  const onEvent = opts.onEvent ?? (() => {});

  let findings: Finding[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reply = await deps.run(
      buildPrompt(lessonTitle, step, source, sourceExcerpt, findings),
      onEvent,
    );
    const { cards, check } = parseCardsReply(reply);

    findings = [
      ...auditStep(cards, step.body),
      ...auditCheck(check, step.body),
      ...checkDropped(step, check),
    ];
    // warning — это «стоит разнообразить», а не брак: карточка не учит
    // неправильному. Останавливать на этом запись и жечь единственный повтор
    // незачем, поэтому за error здесь следят отдельно от findings в отчёте.
    const blocking = findings.filter((finding) => finding.severity === "error");
    if (blocking.length) continue;

    const written = withFingerprints(cards, step.id);
    // Пустой список здесь — обдуманное «у этого шага карточек нет», а не
    // провал: до этой строки доходят только попытки, прошедшие аудит. Значит
    // прежний файл шага устарел и его надо убрать. Забракованная попытка сюда
    // не доходит и старые карточки не теряет — одна неудачная генерация не
    // должна стоить читателю набранного графика повторений.
    if (written.length) writeCards(contentDir, slug, step.id, written);
    else removeCards(contentDir, slug, step.id);
    return { stepId: step.id, cards: written, check, findings };
  }

  return { stepId: step.id, cards: [], check: [], findings };
}
