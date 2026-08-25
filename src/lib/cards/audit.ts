import { answerText, type CardDraft } from "./card";

export interface Finding {
  ref: string;
  rule: string;
  severity: "error" | "warning";
  message: string;
}

export type StepRule = (cards: CardDraft[], stepBody: string) => Finding[];
export type LessonRule = (cards: CardDraft[]) => Finding[];

/** Пока карточка не записана, у неё нет id — в findings идёт её вопрос. */
function refOf(card: CardDraft): string {
  return card.question.slice(0, 60);
}

/**
 * Обороты, указывающие на текст рядом.
 *
 * Карточку показывают через месяц на отдельной странице, где никакого «выше»
 * не существует. Список закрытый и короткий намеренно: широкий список ловит
 * законные обороты вроде «выше нуля».
 *
 * Для Cyrillic текста \b не работает, поэтому используем lookahead/lookbehind с классом
 * символов. Начало word boundary: (?<![а-яА-ЯёЁ]). Конец: (?![а-яА-ЯёЁ]).
 */
const DEICTIC = [
  /(?<![а-яА-ЯёЁ])в примере(?![а-яА-ЯёЁ])/i,
  /(?<![а-яА-ЯёЁ])выше(?![а-яА-ЯёЁ])(?!\s+нул)/i,
  /(?<![а-яА-ЯёЁ])ниже(?![а-яА-ЯёЁ])(?!\s+нул)/i,
  /(?<![а-яА-ЯёЁ])мы получили(?![а-яА-ЯёЁ])/i,
  /(?<![а-яА-ЯёЁ])на этом шаге(?![а-яА-ЯёЁ])/i,
  /(?<![а-яА-ЯёЁ])как показано(?![а-яА-ЯёЁ])/i,
  /(?<![а-яА-ЯёЁ])в предыдущем(?![а-яА-ЯёЁ])/i,
  /(?<![а-яА-ЯёЁ])в тексте(?![а-яА-ЯёЁ])/i,
];

const STEP_REFERENCE = /(?<![а-яА-ЯёЁ])шаг[ае]?\s*№?\s*\d+/i;

/** Числа, которые встречаются в тексте про что угодно. */
const UBIQUITOUS = new Set(["0", "1", "2"]);

/** Всё, что человек читает в карточке, кроме разбора. */
function askedText(card: CardDraft): string {
  const parts = [card.question];
  if (card.kind === "choice") parts.push(...card.options);
  if (card.kind === "cloze") parts.push(card.template, card.answer, ...card.accept);
  if (card.kind === "order") parts.push(...card.items);
  if (card.kind === "numeric") parts.push(String(card.answer));
  return parts.join("\n");
}

function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((value) => value.replace(",", "."));
}

const deictic: StepRule = (cards) =>
  cards.flatMap((card) => {
    const text = askedText(card);
    const hit = DEICTIC.find((pattern) => pattern.test(text));
    return hit
      ? [
          {
            ref: refOf(card),
            rule: "deictic",
            severity: "error" as const,
            message: `Указательный оборот ${hit.source}: карточка показывается вне урока, указывать не на что`,
          },
        ]
      : [];
  });

/**
 * Главное правило спеки.
 *
 * Ловит ровно тот случай, ради которого затеян весь проход: в шаге напечатано
 * «loss 4.17 при словаре из 65 символов», а вопрос спрашивает про 4.17. Такой
 * вопрос проверяет память на число из соседнего абзаца, а не понимание.
 * Разбор (`explanation`) из проверки исключён: он обязан ссылаться на материал
 * урока и обязан называть его числа.
 */
const numberOverlap: StepRule = (cards, stepBody) => {
  const inBody = new Set(numbersIn(stepBody));
  return cards.flatMap((card) => {
    const shared = numbersIn(askedText(card)).filter(
      (value) => !UBIQUITOUS.has(value) && inBody.has(value),
    );
    return shared.length
      ? [
          {
            ref: refOf(card),
            rule: "number-overlap",
            severity: "error" as const,
            message: `Числа ${shared.join(", ")} взяты из текста шага — возьми другие`,
          },
        ]
      : [];
  });
};

const stepReference: StepRule = (cards) =>
  cards.flatMap((card) =>
    STEP_REFERENCE.test(askedText(card))
      ? [
          {
            ref: refOf(card),
            rule: "step-reference",
            severity: "error" as const,
            message: "Ссылка на номер шага: вне урока номера ничего не значат",
          },
        ]
      : [],
  );

const answerIntegrity: StepRule = (cards) =>
  cards.flatMap((card) => {
    const problems: string[] = [];
    if (card.kind === "choice") {
      if (new Set(card.options).size !== card.options.length) {
        problems.push("варианты повторяются");
      }
      if (!card.options[card.correct]) problems.push("correct не указывает на вариант");
    }
    if (card.kind === "order" && new Set(card.items).size !== card.items.length) {
      problems.push("шаги повторяются");
    }
    if (!answerText(card)) problems.push("пустой правильный ответ");
    return problems.length
      ? [
          {
            ref: refOf(card),
            rule: "answer-integrity",
            severity: "error" as const,
            message: problems.join("; "),
          },
        ]
      : [];
  });

const duplicateConcept: LessonRule = (cards) => {
  const seen = new Map<string, number>();
  const findings: Finding[] = [];
  for (const card of cards) {
    const key = card.concept.trim().toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) {
      findings.push({
        ref: refOf(card),
        rule: "duplicate-concept",
        severity: "error",
        message: `Идея «${card.concept}» уже проверяется другой карточкой урока`,
      });
    }
  }
  return findings;
};

/**
 * Однообразие — предупреждение, а не ошибка.
 *
 * У урока из трёх шагов три карточки одного вида — норма, а не брак. Порог в
 * три карточки взят оттуда же: на двух говорить о разнообразии не о чем.
 */
const kindVariety: LessonRule = (cards) => {
  if (cards.length < 3) return [];
  const kinds = new Set(cards.map((card) => card.kind));
  if (kinds.size > 1) return [];
  return [
    {
      ref: refOf(cards[0]),
      rule: "kind-variety",
      severity: "warning",
      message: `Все карточки урока вида ${cards[0].kind} — разнообразь`,
    },
  ];
};

export const STEP_RULES: StepRule[] = [deictic, numberOverlap, stepReference, answerIntegrity];
export const LESSON_RULES: LessonRule[] = [duplicateConcept, kindVariety];

export function auditStep(cards: CardDraft[], stepBody: string): Finding[] {
  return STEP_RULES.flatMap((rule) => rule(cards, stepBody));
}

export function auditLesson(cards: CardDraft[]): Finding[] {
  return LESSON_RULES.flatMap((rule) => rule(cards));
}

export function formatFindings(findings: Finding[]): string {
  return findings
    .map((finding) => `- [${finding.severity}] ${finding.rule} (${finding.ref}): ${finding.message}`)
    .join("\n");
}
