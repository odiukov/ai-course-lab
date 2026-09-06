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

/**
 * Сколько шагов разбирается одним вызовом агента.
 *
 * Вызов состоит из двух частей. Постоянная — правила написания карточек,
 * вопросы курса, список занятых идей — не зависит от числа шагов и тянет
 * порядка двух с половиной тысяч токенов. Переменная — срез исходника, текст
 * шага, шов кода и существующие вопросы — примерно столько же на КАЖДЫЙ шаг.
 * Пока шаги шли по одному, половина всего прохода уходила на пересылку одних и
 * тех же правил: сорок два урока фазы 14 стоили пяти окон лимита.
 *
 * Шесть — там, где кривая выигрыша ложится. Постоянная часть падает до
 * пятой доли вызова, дальше экономия почти не растёт (двенадцать шагов дают
 * лишь пять процентных пунктов сверху), а цена растёт сразу по двум статьям:
 * ответ на двенадцать шагов подходит к порогу обрыва JSON, и один невнятный
 * ответ стоит вдвое большего куска урока. При шести ответ — до восемнадцати
 * карточек, до порога далеко.
 */
export const CARDS_BATCH_SIZE = 6;

const stepReplySchema = z.object({
  id: z.string(),
  cards: z.array(cardDraftSchema).default([]),
  check: z.array(checkSchema).default([]),
});

/**
 * Внешняя форма ответа разбирается отдельно от содержимого шагов.
 *
 * Схема карточки — discriminatedUnion с superRefine, и она строга по делу:
 * `choice` с индексом верного ответа вне списка вариантов или `cloze` без
 * пропуска `___` — это не карточка. Но разбирать ими весь ответ разом нельзя.
 * Одна такая карточка роняет safeParse всего объекта, и пока шаг был один на
 * вызов, это стоило одного шага, а в пачке стало стоить шести: урок 27 фазы 14
 * потерял так шаги 019–024 целиком, причём дважды подряд — брак
 * детерминированный, повтор его воспроизводит.
 *
 * Поэтому здесь у шагов проверяется только оболочка, а карточки каждого шага
 * валидируются своей схемой по отдельности.
 */
const replyShellSchema = z.object({
  steps: z.array(z.object({ id: z.string() }).loose()).default([]),
});

/** Ответ агента по одному шагу пачки. */
export interface StepReply {
  cards: CardDraft[];
  check: CheckQuestion[];
}

export interface ParsedReply {
  /** Шаги, разобранные успешно. */
  byStep: Map<string, StepReply>;
  /** Шаги, которые в ответе были, но не прошли схему: id → в чём именно брак. */
  malformed: Map<string, string>;
}

export interface StepCardsResult {
  stepId: string;
  cards: Card[];
  check: CheckQuestion[];
  findings: Finding[];
}

/**
 * Шаг, про который агент не ответил ничего.
 *
 * Пока шаг был один на вызов, молчание агента и его же осознанное «карточек
 * здесь нет» выглядели одинаково — пустым списком, — и различать их было
 * незачем: разобранный ответ на один шаг либо есть, либо нет вовсе. В пачке
 * из шести разница становится дорогой. Обрыв ответа на середине оставляет
 * первые три шага разобранными, а последние три — просто отсутствующими, и
 * если считать отсутствие за «карточек нет», проход молча сотрёт с диска
 * карточки трёх шагов и запишет это в отчёт как успех.
 *
 * Поэтому пропущенный шаг — это замечание и повтор, а не пустой результат.
 */
/**
 * Претензии схемы — словами, которые агент может исправить.
 *
 * Путь до поля здесь важнее текста: «cards.0.correct: индекс правильного
 * ответа вне списка вариантов» говорит, что чинить, а голое «Invalid input»
 * не говорит ничего, и повтор воспроизводит тот же брак.
 */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "<корень>"}: ${issue.message}`)
    .join("; ");
}

function stepMalformed(step: Step, reason: string): Finding {
  return {
    ref: step.id,
    rule: "step-malformed",
    severity: "error",
    message: `Ответ по шагу ${step.id} не той формы — ${reason}`,
  };
}

function stepMissing(step: Step): Finding {
  return {
    ref: step.id,
    rule: "step-missing",
    severity: "error",
    message:
      `Шага ${step.id} нет в ответе — верни объект на КАЖДЫЙ шаг из списка, ` +
      "а шаг без запоминаемой идеи отдай с пустыми списками, а не молчанием.",
  };
}

/**
 * Разбор ответа агента.
 *
 * Мусор вместо JSON и JSON не той формы обрабатываются одинаково — пустой
 * картой, а не исключением. Один невнятный ответ посреди прохода по сотням
 * шагов не должен ронять весь прогон: пустая карта означает «ни один шаг не
 * разобран», это видно дальше в findings и в отчёте.
 *
 * Пачка из одного шага разбирается и без обёртки `steps`: модель, получившая
 * ровно один шаг, регулярно отвечает плоским `{ cards, check }`. На пачке из
 * нескольких шагов такой ответ принимать нельзя — непонятно, какому шагу он
 * принадлежит.
 */
export function parseCardsReply(reply: string, stepIds: string[]): ParsedReply {
  const byStep = new Map<string, StepReply>();
  const malformed = new Map<string, string>();

  let block: unknown;
  try {
    block = extractJsonBlock(reply);
  } catch {
    return { byStep, malformed };
  }

  const shell = replyShellSchema.safeParse(block);
  if (shell.success && shell.data.steps.length) {
    for (const entry of shell.data.steps) {
      if (!stepIds.includes(entry.id)) continue;
      const parsed = stepReplySchema.safeParse(entry);
      if (parsed.success) byStep.set(entry.id, { cards: parsed.data.cards, check: parsed.data.check });
      else malformed.set(entry.id, describeIssues(parsed.error));
    }
    return { byStep, malformed };
  }

  if (stepIds.length === 1) {
    const flat = z
      .object({
        cards: z.array(cardDraftSchema).default([]),
        check: z.array(checkSchema).default([]),
      })
      .safeParse(block);
    if (flat.success) byStep.set(stepIds[0], flat.data);
  }

  return { byStep, malformed };
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

/**
 * Идеи, уже разобранные карточками этого урока.
 *
 * Без этого списка правило промпта «две карточки урока не могут проверять
 * одну идею» соблюдать нечем: шаг пишется отдельным вызовом и карточек
 * соседних шагов не видит. В живом уроке про линейную алгебру это стоило
 * четырёх карточек про евклидову норму на шагах 1, 3, 4 и 8 — учащийся
 * получил один вопрос трижды за десять. Ровно та же болезнь и ровно то же
 * лекарство, что у текста шагов в buildCoveredContext.
 *
 * Шаги внутри одной пачки в этот список не попадают — их карточки пишутся тем
 * же вызовом и на момент его отправки ещё не существуют. За повторами внутри
 * пачки следит отдельное правило промпта, а сеткой снизу остаётся auditLesson.
 */
function formatCoveredConcepts(concepts: string[]): string {
  if (!concepts.length) return "(это первые карточки урока)";
  return concepts.map((concept) => `- ${concept}`).join("\n");
}

/**
 * Блок одного шага внутри пачки.
 *
 * Объяснения, общие для всех шагов — что срез исходника это материал, а наш
 * текст шага материалом не является, — вынесены в постоянную часть промпта и
 * здесь не повторяются: ровно на этом повторе пачка и экономит.
 */
function formatStepBlock(
  step: Step,
  source: LessonSource,
  sourceExcerpt: string,
  findings: Finding[],
): string {
  return [
    `### Шаг \`${step.id}\` — ${step.title} (тип: ${step.type})`,
    "",
    "Материал курса:",
    "",
    "---",
    sourceExcerpt,
    "---",
    "",
    "Шов кода:",
    "",
    "```",
    exerciseCodeForStep(source, step),
    "```",
    "",
    "Наш текст шага:",
    "",
    "---",
    step.body,
    "---",
    "",
    "Существующие вопросы check:",
    "",
    step.check?.length ? JSON.stringify(step.check, null, 2) : "(их нет)",
    "",
    "Замечания к прошлой попытке:",
    "",
    findings.length ? formatFindings(findings) : "(это первая попытка)",
    "",
  ].join("\n");
}

function buildPrompt(
  lessonTitle: string,
  steps: Step[],
  source: LessonSource,
  sourceExcerpts: Map<string, string>,
  coveredConcepts: string[],
  findings: Map<string, Finding[]>,
): string {
  return renderPrompt("write-cards", {
    lesson_title: lessonTitle,
    covered_concepts: formatCoveredConcepts(coveredConcepts),
    source_quiz: formatSourceQuiz(source.quiz),
    steps: steps
      .map((step) =>
        formatStepBlock(
          step,
          source,
          sourceExcerpts.get(step.id) ?? source.text,
          findings.get(step.id) ?? [],
        ),
      )
      .join("\n"),
  });
}

/**
 * Карточки и починенные вопросы пачки идущих подряд шагов.
 *
 * Один вызов агента выдаёт и то, и другое сразу по нескольким шагам: правила
 * написания карточек и вопросы курса одинаковы для всего урока, и платить за
 * их пересылку на каждом шаге незачем. Почему именно шесть — в комментарии к
 * CARDS_BATCH_SIZE.
 *
 * `source` и `sourceExcerpts` обязательны, а не необязательны с запасным
 * вариантом: материал вопроса — исходник курса, и вызов без него молча
 * возвращает нас к тому, ради чего затеяно изменение — к карточкам по нашему
 * же пересказу. Пусть лучше не соберётся типами.
 *
 * Повтор ровно один и ровно по тем шагам, которые не прошли аудит: один
 * бракованный шаг не должен заставлять переписывать пять соседних, уже
 * лежащих на диске. Замечания первой попытки уходят агенту вместе с исходным
 * заданием; если и вторая попытка не прошла, на диск по этому шагу не
 * пишется ничего, а шаг попадает в отчёт человеку. Писать забракованное «пока
 * так» нельзя: карточка уедет в график повторений и будет учить не тому.
 */
export async function writeCardsForSteps(opts: {
  contentDir: string;
  slug: string;
  steps: Step[];
  source: LessonSource;
  /** Срезы исходника по `source_anchor` шагов — что именно каждый шаг покрывает. */
  sourceExcerpts: Map<string, string>;
  /** `concept` карточек, уже написанных для предыдущих пачек этого урока. */
  coveredConcepts: string[];
  deps: GenerateDeps;
  lessonTitle?: string;
  onEvent?: (event: AgentEvent) => void;
}): Promise<StepCardsResult[]> {
  const { contentDir, slug, steps, source, sourceExcerpts, coveredConcepts, deps } = opts;
  const lessonTitle = opts.lessonTitle ?? slug;
  const onEvent = opts.onEvent ?? (() => {});

  const results = new Map<string, StepCardsResult>();
  // Карточки, принятые первой попыткой, дописываются к занятым идеям: повтор
  // отправляется отдельным вызовом и без этого мог бы взять идею соседа по
  // пачке, которую тот занял минуту назад.
  const covered = [...coveredConcepts];
  let pending = steps;
  let findings = new Map<string, Finding[]>();

  for (let attempt = 0; attempt < 2 && pending.length; attempt += 1) {
    const reply = await deps.run(
      buildPrompt(lessonTitle, pending, source, sourceExcerpts, covered, findings),
      onEvent,
    );
    const parsed = parseCardsReply(
      reply,
      pending.map((step) => step.id),
    );

    const failed: Step[] = [];
    const nextFindings = new Map<string, Finding[]>();

    for (const step of pending) {
      const answer = parsed.byStep.get(step.id);
      const broken = parsed.malformed.get(step.id);
      const stepFindings = answer
        ? [
            ...auditStep(answer.cards, step.body),
            ...auditCheck(answer.check, step.body),
            ...checkDropped(step, answer.check),
          ]
        : [broken ? stepMalformed(step, broken) : stepMissing(step)];

      // warning — это «стоит разнообразить», а не брак: карточка не учит
      // неправильному. Останавливать на этом запись и жечь единственный повтор
      // незачем, поэтому за error здесь следят отдельно от findings в отчёте.
      if (stepFindings.some((finding) => finding.severity === "error")) {
        failed.push(step);
        nextFindings.set(step.id, stepFindings);
        results.set(step.id, { stepId: step.id, cards: [], check: [], findings: stepFindings });
        continue;
      }

      const written = withFingerprints(answer?.cards ?? [], step.id);
      // Пустой список здесь — обдуманное «у этого шага карточек нет», а не
      // провал: до этой строки доходят только шаги, прошедшие аудит. Значит
      // прежний файл шага устарел и его надо убрать. Забракованный шаг сюда
      // не доходит и старые карточки не теряет — одна неудачная генерация не
      // должна стоить читателю набранного графика повторений.
      if (written.length) writeCards(contentDir, slug, step.id, written);
      else removeCards(contentDir, slug, step.id);

      covered.push(...written.map((card) => card.concept));
      results.set(step.id, {
        stepId: step.id,
        cards: written,
        check: answer?.check ?? [],
        findings: stepFindings,
      });
    }

    pending = failed;
    findings = nextFindings;
  }

  return steps.map(
    (step) =>
      results.get(step.id) ?? { stepId: step.id, cards: [], check: [], findings: [] },
  );
}

/**
 * Один шаг — пачка из одного.
 *
 * Оставлено ради вызывающих, которым пачка не нужна, и ради тестов, где
 * поведение по одному шагу проверяется поштучно.
 */
export async function writeCardsForStep(opts: {
  contentDir: string;
  slug: string;
  step: Step;
  source: LessonSource;
  sourceExcerpt: string;
  coveredConcepts: string[];
  deps: GenerateDeps;
  lessonTitle?: string;
  onEvent?: (event: AgentEvent) => void;
}): Promise<StepCardsResult> {
  const [result] = await writeCardsForSteps({
    ...opts,
    steps: [opts.step],
    sourceExcerpts: new Map([[opts.step.id, opts.sourceExcerpt]]),
  });
  return result;
}
