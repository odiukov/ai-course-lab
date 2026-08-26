import { z } from "zod";
import type { AgentEvent } from "../agent/events";
import { renderPrompt } from "../agent/prompts";
import { auditCheck, auditStep, formatFindings, type Finding } from "../cards/audit";
import {
  cardDraftSchema,
  withFingerprints,
  writeCards,
  type Card,
  type CardDraft,
} from "../cards/card";
import { checkSchema, type CheckQuestion, type Step } from "../content/step-file";
import { extractJsonBlock, type GenerateDeps } from "./plan-lesson";

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

function buildPrompt(lessonTitle: string, step: Step, findings: Finding[]): string {
  return renderPrompt("write-cards", {
    lesson_title: lessonTitle,
    step_title: step.title,
    step_type: step.type,
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
 * Повтор ровно один. Замечания первой попытки уходят агенту вместе с исходным
 * заданием; если и вторая попытка не прошла аудит, на диск не пишется ничего,
 * а шаг попадает в отчёт человеку. Писать забракованное «пока так» нельзя:
 * карточка уедет в график повторений и будет учить не тому.
 */
export async function writeCardsForStep(opts: {
  contentDir: string;
  slug: string;
  step: Step;
  deps: GenerateDeps;
  lessonTitle?: string;
  onEvent?: (event: AgentEvent) => void;
}): Promise<StepCardsResult> {
  const { contentDir, slug, step, deps } = opts;
  const lessonTitle = opts.lessonTitle ?? slug;
  const onEvent = opts.onEvent ?? (() => {});

  let findings: Finding[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reply = await deps.run(buildPrompt(lessonTitle, step, findings), onEvent);
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
    if (written.length) writeCards(contentDir, slug, step.id, written);
    return { stepId: step.id, cards: written, check, findings };
  }

  return { stepId: step.id, cards: [], check: [], findings };
}
