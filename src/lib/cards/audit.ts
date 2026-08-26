import { answerText, type CardDraft } from "./card";
import type { CheckQuestion } from "../content/step-file";

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
 * Бывшая версия ловила голые «выше»/«ниже» с одним исключением на «нул» —
 * из расчёта на «выше нуля». Прогон урока про теорему Байеса показал, что
 * в текстах про вероятность, метрики и A/B-тесты «выше»/«ниже» почти всегда
 * сравнительные («вероятность B выше вероятности A», «ниже среднего»), а не
 * дейктические. Правило съедало законные карточки на каждом таком уроке.
 * Дейктический смысл «выше» — «раньше по тексту» — в русском несут не голые
 * слова, а обороты («см. выше», «приведённый выше», «формула выше»), поэтому
 * ловим именно обороты, а не слово само по себе.
 *
 * Для Cyrillic текста \b не работает, поэтому используем lookahead/lookbehind с классом
 * символов. Начало word boundary: (?<![а-яА-ЯёЁ]). Конец: (?![а-яА-ЯёЁ]).
 * Каждый паттерн с label: label интерполируется в сообщение об ошибке вместо
 * raw .source регулярного выражения, чтобы сообщение было понятно человеку.
 */
interface DeicticPattern {
  label: string;
  pattern: RegExp;
}

/** Существительные, называющие часть шага, на которую можно сослаться дейктически. */
const REFERABLE_NOUN = "(?:формул|пример|код|таблиц)[а-я]*";

const DEICTIC: DeicticPattern[] = [
  { label: "в примере", pattern: /(?<![а-яА-ЯёЁ])в примере(?![а-яА-ЯёЁ])/i },
  {
    label: "выше",
    pattern: new RegExp(
      "(?<![а-яА-ЯёЁ])(?:" +
        "(?:см\\.|смотри)\\s+выше" + // «см. выше», «смотри выше»
        "|как\\s+выше" + // «как выше»
        "|выше\\s+по\\s+тексту" + // «выше по тексту»
        "|привед[её]нн(?:ый|ая|ое|ые)\\s+выше" + // «приведённый/-ая/-ое/-ые выше»
        "|показанн(?:ый|ая|ое|ые)\\s+выше" + // «показанный/-ая/-ое/-ые выше»
        `|${REFERABLE_NOUN}\\s+выше` + // «формула/пример/код/таблица выше»
        ")(?![а-яА-ЯёЁ])",
      "i",
    ),
  },
  {
    label: "ниже",
    pattern: new RegExp(
      "(?<![а-яА-ЯёЁ])(?:" +
        "(?:см\\.|смотри)\\s+ниже" + // «см. ниже», «смотри ниже»
        "|привед[её]нн(?:ый|ая|ое|ые)\\s+ниже" + // «приведённый/-ая/-ое/-ые ниже»
        "|показанн(?:ый|ая|ое|ые)\\s+ниже" + // «показанный/-ая/-ое/-ые ниже»
        `|${REFERABLE_NOUN}\\s+ниже` + // «формула/пример/код/таблица ниже»
        ")(?![а-яА-ЯёЁ])",
      "i",
    ),
  },
  { label: "мы получили", pattern: /(?<![а-яА-ЯёЁ])мы получили(?![а-яА-ЯёЁ])/i },
  { label: "на этом шаге", pattern: /(?<![а-яА-ЯёЁ])на этом шаге(?![а-яА-ЯёЁ])/i },
  { label: "как показано", pattern: /(?<![а-яА-ЯёЁ])как показано(?![а-яА-ЯёЁ])/i },
  { label: "в предыдущем", pattern: /(?<![а-яА-ЯёЁ])в предыдущем(?![а-яА-ЯёЁ])/i },
  { label: "в тексте", pattern: /(?<![а-яА-ЯёЁ])в тексте(?![а-яА-ЯёЁ])/i },
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

/**
 * Всё, что человек видит при решении карточки: вопрос, варианты/шаблон/элементы,
 * плюс explanation и reference для open карточек.
 *
 * Reference и explanation — части ответа, прочитанные ПОСЛЕ попытки, одна категория.
 * Обе должны быть свободны ссылаться на числа урока (пересечение чисел их не касается),
 * но обе не должны указывать на текст вне карточки (дейктика и ссылки на шаги их касаются).
 * Это закрывает дыры: open карточки не проверялись дейктикой/step-reference,
 * explanation тоже не проверялась дейктикой.
 */
function shownText(card: CardDraft): string {
  let text = askedText(card);
  text += "\n" + card.explanation;
  if (card.kind === "open") {
    text += "\n" + card.reference;
  }
  return text;
}

function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((value) => value.replace(",", "."));
}

const deictic: StepRule = (cards) =>
  cards.flatMap((card) => {
    const text = shownText(card);
    const hit = DEICTIC.find(({ pattern }) => pattern.test(text));
    return hit
      ? [
          {
            ref: refOf(card),
            rule: "deictic",
            severity: "error" as const,
            message: `Указательный оборот «${hit.label}»: карточка показывается вне урока, указывать не на что`,
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
    STEP_REFERENCE.test(shownText(card))
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

/**
 * Правила для вопросов внутри шага — подмножество правил карточек.
 *
 * Разница по существу: вопрос `check` задают сразу после чтения абзаца, и
 * опираться на контекст шага ему законно. Незаконно другое — быть вопросом,
 * ПРАВИЛЬНЫЙ ОТВЕТ на который напечатан строкой выше. Поэтому число из урока
 * в условии допустимо, а в правильном варианте — нет.
 */
export function auditCheck(questions: CheckQuestion[], stepBody: string): Finding[] {
  const inBody = new Set(numbersIn(stepBody));
  return questions.flatMap((question) => {
    const findings: Finding[] = [];
    const ref = question.question.slice(0, 60);

    const answer = question.options[question.correct] ?? "";
    const shared = numbersIn(answer).filter(
      (value) => !UBIQUITOUS.has(value) && inBody.has(value),
    );
    if (shared.length) {
      findings.push({
        ref,
        rule: "number-answer",
        severity: "error",
        message: `Правильный ответ — число ${shared.join(", ")} из текста шага: спроси про идею, а не про число`,
      });
    }

    const problems: string[] = [];
    if (new Set(question.options).size !== question.options.length) {
      problems.push("варианты повторяются");
    }
    if (!answer) problems.push("correct не указывает на вариант");
    if (problems.length) {
      findings.push({
        ref,
        rule: "answer-integrity",
        severity: "error",
        message: problems.join("; "),
      });
    }

    return findings;
  });
}
