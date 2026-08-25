# Review Cards Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Породить слой карточек повторения рядом с шагами курса и починить существующие вопросы `check`, механически не пропуская вопросы, ответ на которые — число из соседнего абзаца.

**Architecture:** Форма карточки описана одной zod-схемой в `src/lib/cards/card.ts`; качество проверяется списком чистых правил в `src/lib/cards/audit.ts`; проход генерации в `src/lib/generate/write-cards.ts` зовёт агента через существующий `GenerateDeps`, гоняет аудит и один раз переспрашивает с findings. Драйверы — два скрипта: пишущий и проверяющий.

**Tech Stack:** TypeScript, zod 4, js-yaml, gray-matter, vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-08-25-review-cards-generation-design.md`

## Global Constraints

- Карточки лежат в `content/lessons/<slug>/cards/<step-id>.yml`, в git.
- `id` карточки — `<step-id>-<n>`, где `n` начинается с 1.
- `fingerprint` — первые 8 символов hex-представления sha-256 от строки
  `question + "\n" + <текст правильного ответа>`.
- Пять видов карточек: `choice`, `numeric`, `cloze`, `order`, `open`.
- У `choice` не меньше трёх вариантов (строже, чем `checkSchema` с его двумя, —
  это намеренно).
- Числа `0`, `1`, `2` исключены из правила о пересечении чисел.
- Комментарии в коде — по-русски, как во всём `src/lib`. Комментарий объясняет
  причину решения, а не пересказывает строку.
- Коммиты — по-английски, в стиле существующих (`feat:`, `test:`, `docs:`).
- Тесты гоняются через `npx vitest run <путь>`.

---

### Task 1: Форма карточки и её файл

**Files:**
- Modify: `package.json` (зависимость `js-yaml`, типы `@types/js-yaml`)
- Modify: `src/lib/content/paths.ts:39-56` (добавить `cardsDir` и `cardsFile`)
- Create: `src/lib/cards/card.ts`
- Test: `src/lib/cards/card.test.ts`

**Interfaces:**
- Consumes: `lessonPaths` из `src/lib/content/paths.ts`.
- Produces:
  - `type Card` — разобранная карточка с `fingerprint`
  - `type CardDraft` — то же без `fingerprint` (форма ответа агента)
  - `cardDraftSchema: z.ZodType<CardDraft>`, `cardSchema: z.ZodType<Card>`
  - `fingerprint(draft: CardDraft): string`
  - `withFingerprints(drafts: CardDraft[], stepId: string): Card[]`
  - `readCards(contentDir: string, slug: string, stepId: string): Card[] | null`
  - `writeCards(contentDir: string, slug: string, stepId: string, cards: Card[]): void`
  - `answerText(card: CardDraft): string`

- [ ] **Step 1: Поставить js-yaml явно**

Транзитивно он уже приходит с `gray-matter`, но полагаться на чужую
транзитивную зависимость нельзя: `gray-matter` вправе её сменить.

```bash
npm install js-yaml
npm install -D @types/js-yaml
```

- [ ] **Step 2: Написать падающий тест на схему и fingerprint**

Создать `src/lib/cards/card.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  answerText,
  cardDraftSchema,
  fingerprint,
  readCards,
  withFingerprints,
  writeCards,
  type CardDraft,
} from "./card";

const NUMERIC: CardDraft = {
  kind: "numeric",
  concept: "стартовый loss равен логарифму размера словаря",
  question: "В словаре 1024 токена, модель ещё ничего не выучила. Чему примерно равен loss?",
  explanation: "Равномерное распределение по |V| даёт ln(|V|); ln(1024) ≈ 6.93.",
  answer: 6.93,
  tolerance: 0.05,
};

describe("cardDraftSchema", () => {
  it("принимает numeric с допуском", () => {
    expect(cardDraftSchema.parse(NUMERIC)).toEqual(NUMERIC);
  });

  it("отвергает choice с двумя вариантами: их должно быть не меньше трёх", () => {
    const draft = {
      kind: "choice",
      concept: "каузальная маска запрещает смотреть вправо",
      question: "Что делает каузальная маска?",
      explanation: "Обнуляет вес позиций правее текущей.",
      options: ["Запрещает смотреть вправо", "Ускоряет softmax"],
      correct: 0,
    };
    expect(cardDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("отвергает cloze без пропуска в шаблоне", () => {
    const draft = {
      kind: "cloze",
      concept: "нормировка внутри softmax",
      question: "Допиши строку",
      explanation: "Сумма экспонент по последней оси.",
      template: "probs = exp / exp.sum()",
      answer: "axis=-1",
    };
    expect(cardDraftSchema.safeParse(draft).success).toBe(false);
  });
});

describe("fingerprint", () => {
  it("это восемь hex-символов", () => {
    expect(fingerprint(NUMERIC)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("меняется при правке вопроса", () => {
    const edited = { ...NUMERIC, question: NUMERIC.question + " Ответь числом." };
    expect(fingerprint(edited)).not.toBe(fingerprint(NUMERIC));
  });

  it("не меняется при правке разбора: график повторений сбрасывать не за что", () => {
    const edited = { ...NUMERIC, explanation: "Другой текст разбора, та же суть." };
    expect(fingerprint(edited)).toBe(fingerprint(NUMERIC));
  });
});

describe("answerText", () => {
  it("у choice берёт правильный вариант, а не его индекс", () => {
    const card: CardDraft = {
      kind: "choice",
      concept: "что разделяет GPT и BERT",
      question: "Какая деталь отличает GPT от BERT?",
      explanation: "Только запрет смотреть вправо.",
      options: ["SwiGLU", "Каузальная маска", "Остаточные связи"],
      correct: 1,
    };
    expect(answerText(card)).toBe("Каузальная маска");
  });
});

describe("withFingerprints", () => {
  it("нумерует карточки с единицы и приписывает id шага", () => {
    const cards = withFingerprints([NUMERIC, NUMERIC], "046-quiz");
    expect(cards.map((card) => card.id)).toEqual(["046-quiz-1", "046-quiz-2"]);
  });
});

describe("readCards и writeCards", () => {
  it("записанное читается обратно тем же", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cards-"));
    const cards = withFingerprints([NUMERIC], "046-quiz");
    writeCards(dir, "01-math__01-alpha", "046-quiz", cards);
    expect(readCards(dir, "01-math__01-alpha", "046-quiz")).toEqual(cards);
  });

  it("отсутствие файла — не ошибка: у шага просто нет карточек", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cards-"));
    expect(readCards(dir, "01-math__01-alpha", "046-quiz")).toBeNull();
  });
});
```

- [ ] **Step 3: Прогнать тест и убедиться, что он падает**

Run: `npx vitest run src/lib/cards/card.test.ts`
Expected: FAIL, `Failed to resolve import "./card"`.

- [ ] **Step 4: Добавить пути карточек в `lessonPaths`**

В `src/lib/content/paths.ts` в интерфейс `LessonPaths` добавить поля и вернуть
их из функции:

```ts
export interface LessonPaths {
  dir: string;
  planFile: string;
  stepsDir: string;
  clarificationsDir: string;
  visualsDir: string;
  cardsDir: string;
  stepFile(id: string): string;
  clarificationFile(id: string): string;
  visualFile(id: string): string;
  cardsFile(id: string): string;
}
```

В теле `lessonPaths`:

```ts
  const cardsDir = path.join(dir, "cards");
```

и в возвращаемом объекте:

```ts
    cardsDir,
    cardsFile: (id) => path.join(cardsDir, `${id}.yml`),
```

- [ ] **Step 5: Написать `src/lib/cards/card.ts`**

```ts
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { lessonPaths } from "../content/paths";

/**
 * Форма карточки повторения — одним местом.
 *
 * Эту схему читают три стороны: проход генерации (проверяет ответ агента),
 * аудит и сборка сайта. Разъехавшиеся представления о том, что такое
 * карточка, означают сломанный график повторений у людей, поэтому форма
 * описана здесь и больше нигде.
 */
const common = {
  concept: z.string().min(1),
  question: z.string().min(1),
  // Разбор обязателен: карточка без него учит угадывать, а не понимать.
  explanation: z.string().min(1),
};

const choice = z.object({
  ...common,
  kind: z.literal("choice"),
  // Три, а не два как у checkSchema: с двумя вариантами половина ответов
  // угадывается, и интервал повторения растёт на угаданном.
  options: z.array(z.string().min(1)).min(3),
  correct: z.number().int().nonnegative(),
});

const numeric = z.object({
  ...common,
  kind: z.literal("numeric"),
  answer: z.number(),
  // Допуск обязателен: без него ответ 6.93 не сходится с 6.931.
  tolerance: z.number().positive(),
});

const cloze = z.object({
  ...common,
  kind: z.literal("cloze"),
  template: z.string().min(1),
  answer: z.string().min(1),
  /** Синонимичные написания, которые тоже считаются верными. */
  accept: z.array(z.string().min(1)).default([]),
});

const order = z.object({
  ...common,
  kind: z.literal("order"),
  /** В правильном порядке; человеку показываются перемешанными. */
  items: z.array(z.string().min(1)).min(3),
});

const open = z.object({
  ...common,
  kind: z.literal("open"),
  reference: z.string().min(1),
});

export const cardDraftSchema = z
  .discriminatedUnion("kind", [choice, numeric, cloze, order, open])
  .superRefine((card, ctx) => {
    if (card.kind === "choice" && card.correct >= card.options.length) {
      ctx.addIssue({
        code: "custom",
        path: ["correct"],
        message: "Индекс правильного ответа вне списка вариантов",
      });
    }
    if (card.kind === "cloze" && !card.template.includes("___")) {
      ctx.addIssue({
        code: "custom",
        path: ["template"],
        message: "В шаблоне нет пропуска ___",
      });
    }
  });

export type CardDraft = z.infer<typeof cardDraftSchema>;

export const cardSchema = z.intersection(
  cardDraftSchema,
  z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]+$/),
    fingerprint: z.string().regex(/^[0-9a-f]{8}$/),
  }),
);

export type Card = CardDraft & { id: string; fingerprint: string };

/** Текст правильного ответа — то, по чему считается fingerprint. */
export function answerText(card: CardDraft): string {
  switch (card.kind) {
    case "choice":
      return card.options[card.correct] ?? "";
    case "numeric":
      return String(card.answer);
    case "cloze":
      return card.answer;
    case "order":
      return card.items.join("|");
    case "open":
      return card.reference;
  }
}

/**
 * Отпечаток вопроса и ответа.
 *
 * Нужен, чтобы переписанная по существу карточка не унаследовала чужой график
 * повторений: человек получил бы интервал в три месяца на вопрос, которого
 * никогда не видел. В отпечаток входят только вопрос и ответ — правка разбора
 * или опечатки в concept график не сбрасывает.
 */
export function fingerprint(card: CardDraft): string {
  return createHash("sha256")
    .update(`${card.question}\n${answerText(card)}`)
    .digest("hex")
    .slice(0, 8);
}

export function withFingerprints(drafts: CardDraft[], stepId: string): Card[] {
  return drafts.map((draft, index) => ({
    ...draft,
    id: `${stepId}-${index + 1}`,
    fingerprint: fingerprint(draft),
  }));
}

export function readCards(contentDir: string, slug: string, stepId: string): Card[] | null {
  const file = lessonPaths(contentDir, slug).cardsFile(stepId);
  if (!fs.existsSync(file)) return null;
  const parsed = yaml.load(fs.readFileSync(file, "utf8"));
  return z.array(cardSchema).parse(parsed) as Card[];
}

export function writeCards(
  contentDir: string,
  slug: string,
  stepId: string,
  cards: Card[],
): void {
  const file = lessonPaths(contentDir, slug).cardsFile(stepId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // lineWidth: -1 — иначе js-yaml переносит длинные вопросы по словам, и диф
  // на правку одного слова показывает переформатированный абзац целиком.
  fs.writeFileSync(file, yaml.dump(cards, { lineWidth: -1, noRefs: true }), "utf8");
}
```

- [ ] **Step 6: Прогнать тесты и убедиться, что они проходят**

Run: `npx vitest run src/lib/cards/card.test.ts`
Expected: PASS, 9 тестов.

- [ ] **Step 7: Проверить типы всего проекта**

Run: `npm run typecheck`
Expected: без ошибок. Если `lessonPaths` где-то создаётся объектным литералом
в тестах, компилятор укажет на недостающие поля — дописать их там же.

- [ ] **Step 8: Коммит**

```bash
git add package.json package-lock.json src/lib/cards/card.ts src/lib/cards/card.test.ts src/lib/content/paths.ts
git commit -m "feat(cards): add the review card schema and its file format"
```

---

### Task 2: Правила аудита карточек

**Files:**
- Create: `src/lib/cards/audit.ts`
- Test: `src/lib/cards/audit.test.ts`

**Interfaces:**
- Consumes: `Card`, `CardDraft`, `answerText` из `src/lib/cards/card.ts`.
- Produces:
  - `interface Finding { cardId: string; rule: string; severity: "error" | "warning"; message: string }`
  - `type StepRule = (cards: CardDraft[], stepBody: string) => Finding[]`
  - `type LessonRule = (cards: CardDraft[]) => Finding[]`
  - `const STEP_RULES: StepRule[]`, `const LESSON_RULES: LessonRule[]`
  - `auditStep(cards: CardDraft[], stepBody: string): Finding[]`
  - `auditLesson(cards: CardDraft[]): Finding[]`
  - `formatFindings(findings: Finding[]): string`

**Замечание к спеке.** Правило 5 спеки («`explanation` непустой») в список
правил не попадает: его уже держит `cardDraftSchema` через `z.string().min(1)`,
и второе место с той же проверкой разъехалось бы с первым. Правил в списке
шесть, а не семь.

- [ ] **Step 1: Написать падающие тесты правил**

Создать `src/lib/cards/audit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { auditLesson, auditStep } from "./audit";
import type { CardDraft } from "./card";

const STEP_BODY = [
  "Стартовый loss при словаре из 65 символов равен примерно 4.17.",
  "Это натуральный логарифм 65 — модель раскладывает вероятность поровну.",
].join("\n");

function numericCard(over: Partial<CardDraft> = {}): CardDraft {
  return {
    kind: "numeric",
    concept: "стартовый loss равен логарифму размера словаря",
    question: "В словаре 1024 токена. Чему примерно равен loss необученной модели?",
    explanation: "ln(1024) ≈ 6.93.",
    answer: 6.93,
    tolerance: 0.05,
    ...over,
  } as CardDraft;
}

describe("правило: указательные обороты", () => {
  it("заворачивает карточку, ссылающуюся на текст шага", () => {
    const cards = [numericCard({ question: "Чему равен loss в примере выше?" })];
    const findings = auditStep(cards, STEP_BODY);
    expect(findings.map((f) => f.rule)).toContain("deictic");
  });

  it("пропускает самодостаточный вопрос", () => {
    expect(auditStep([numericCard()], STEP_BODY)).toEqual([]);
  });
});

describe("правило: пересечение чисел", () => {
  it("заворачивает вопрос про 4.17 при 4.17 в тексте шага", () => {
    const cards = [
      numericCard({
        question: "Стартовый loss равен 4.17. О чём это говорит?",
        answer: 4.17,
      }),
    ];
    expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("number-overlap");
  });

  it("заворачивает и вопрос про размер словаря 65", () => {
    const cards = [numericCard({ question: "В словаре 65 символов. Чему равен loss?" })];
    expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("number-overlap");
  });

  it("не считает пересечением 0, 1 и 2: они есть в любом тексте", () => {
    const body = "Индексация с 0, шаг 1, ось 2.";
    const cards = [numericCard({ question: "Сколько осей у матрицы 2 на 3?", answer: 2 })];
    expect(auditStep(cards, body).map((f) => f.rule)).not.toContain("number-overlap");
  });

  it("не смотрит в explanation: разбор обязан ссылаться на материал урока", () => {
    const cards = [numericCard({ explanation: "В уроке словарь был 65, ln(65) ≈ 4.17." })];
    expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).not.toContain("number-overlap");
  });
});

describe("правило: ссылки на номера шагов", () => {
  it("заворачивает «см. шаг 12»", () => {
    const cards = [numericCard({ question: "См. шаг 12: чему равен loss?" })];
    expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("step-reference");
  });
});

describe("правило: целостность ответа", () => {
  it("заворачивает choice с повторяющимися вариантами", () => {
    const cards: CardDraft[] = [
      {
        kind: "choice",
        concept: "что разделяет GPT и BERT",
        question: "Какая деталь отличает GPT от BERT?",
        explanation: "Запрет смотреть вправо.",
        options: ["Каузальная маска", "SwiGLU", "Каузальная маска"],
        correct: 0,
      },
    ];
    expect(auditStep(cards, STEP_BODY).map((f) => f.rule)).toContain("answer-integrity");
  });
});

describe("правила урока", () => {
  it("заворачивает две карточки на один concept", () => {
    const cards = [numericCard(), numericCard({ question: "А теперь при 2048 токенах?" })];
    expect(auditLesson(cards).map((f) => f.rule)).toContain("duplicate-concept");
  });

  it("предупреждает, если все карточки урока одного вида", () => {
    const cards = [
      numericCard({ concept: "первое" }),
      numericCard({ concept: "второе" }),
      numericCard({ concept: "третье" }),
    ];
    const findings = auditLesson(cards);
    const variety = findings.find((f) => f.rule === "kind-variety");
    expect(variety?.severity).toBe("warning");
  });

  it("не предупреждает про однообразие у урока с одной карточкой", () => {
    expect(auditLesson([numericCard()]).map((f) => f.rule)).not.toContain("kind-variety");
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run src/lib/cards/audit.test.ts`
Expected: FAIL, `Failed to resolve import "./audit"`.

- [ ] **Step 3: Написать `src/lib/cards/audit.ts`**

```ts
import { answerText, type CardDraft } from "./card";

export interface Finding {
  cardId: string;
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
 */
const DEICTIC = [
  /\bв примере\b/i,
  /\bвыше\b(?!\s+нул)/i,
  /\bниже\b(?!\s+нул)/i,
  /\bмы получили\b/i,
  /\bна этом шаге\b/i,
  /\bкак показано\b/i,
  /\bв предыдущем\b/i,
  /\bв тексте\b/i,
];

const STEP_REFERENCE = /\bшаг[ае]?\s*№?\s*\d+/i;

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
            cardId: refOf(card),
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
            cardId: refOf(card),
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
            cardId: refOf(card),
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
            cardId: refOf(card),
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
        cardId: refOf(card),
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
      cardId: refOf(cards[0]),
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
    .map((finding) => `- [${finding.severity}] ${finding.rule} (${finding.cardId}): ${finding.message}`)
    .join("\n");
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run src/lib/cards/audit.test.ts`
Expected: PASS, 11 тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/cards/audit.ts src/lib/cards/audit.test.ts
git commit -m "feat(cards): reject cards that recycle numbers from the step body"
```

---

### Task 3: Правила для починенных `check`

**Files:**
- Modify: `src/lib/cards/audit.ts` (добавить `auditCheck`)
- Modify: `src/lib/cards/audit.test.ts` (добавить блок тестов)

**Interfaces:**
- Consumes: `Finding`, `numbersIn`, `UBIQUITOUS` из того же файла.
- Produces: `auditCheck(questions: CheckQuestion[], stepBody: string): Finding[]`

`CheckQuestion` берётся из `src/lib/content/step-file.ts` — новой формы не
заводим.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `src/lib/cards/audit.test.ts`:

```ts
import { auditCheck } from "./audit";
import type { CheckQuestion } from "../content/step-file";

describe("auditCheck — правила для вопросов внутри шага", () => {
  const body = "Стартовый loss при словаре из 65 символов равен примерно 4.17.";

  it("разрешает указательные обороты: вопрос задают в контексте шага", () => {
    const questions: CheckQuestion[] = [
      {
        question: "Почему в примере выше стартовый loss именно такой?",
        options: [
          "Модель раскладывает вероятность поровну между токенами",
          "Модель уже что-то выучила",
          "В коде ошибка",
        ],
        correct: 0,
        explanation: "Равномерное распределение даёт ln(|V|).",
      },
    ];
    expect(auditCheck(questions, body).map((f) => f.rule)).not.toContain("deictic");
  });

  it("заворачивает вопрос, ответ на который — число из текста шага", () => {
    const questions: CheckQuestion[] = [
      {
        question: "Чему равен стартовый loss?",
        options: ["4.17", "0.0", "65"],
        correct: 0,
        explanation: "ln(65) ≈ 4.17.",
      },
    ];
    expect(auditCheck(questions, body).map((f) => f.rule)).toContain("number-answer");
  });

  it("пропускает вопрос про идею, даже если число урока стоит в условии", () => {
    const questions: CheckQuestion[] = [
      {
        question: "Стартовый loss оказался около 4.17 при словаре из 65 символов. Почему?",
        options: [
          "Модель считает все символы равновероятными",
          "Маска не работает",
          "Скорость обучения слишком велика",
        ],
        correct: 0,
        explanation: "Равномерное распределение по |V| даёт ln(|V|).",
      },
    ];
    expect(auditCheck(questions, body)).toEqual([]);
  });

  it("заворачивает повторяющиеся варианты", () => {
    const questions: CheckQuestion[] = [
      {
        question: "Что делает каузальная маска?",
        options: ["Запрещает смотреть вправо", "Ускоряет softmax", "Запрещает смотреть вправо"],
        correct: 0,
        explanation: "Обнуляет вес позиций правее текущей.",
      },
    ];
    expect(auditCheck(questions, body).map((f) => f.rule)).toContain("answer-integrity");
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run src/lib/cards/audit.test.ts`
Expected: FAIL, `auditCheck is not a function`.

- [ ] **Step 3: Дописать `auditCheck` в `src/lib/cards/audit.ts`**

```ts
import type { CheckQuestion } from "../content/step-file";

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
        cardId: ref,
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
        cardId: ref,
        rule: "answer-integrity",
        severity: "error",
        message: problems.join("; "),
      });
    }

    return findings;
  });
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run src/lib/cards/audit.test.ts`
Expected: PASS, 15 тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/cards/audit.ts src/lib/cards/audit.test.ts
git commit -m "feat(cards): audit in-step check questions for number-recall answers"
```

---

### Task 4: Промпт генерации

**Files:**
- Create: `prompts/write-cards.md`
- Modify: `src/lib/agent/prompts.ts:4-15` (добавить `"write-cards"` в `PromptName`)

**Interfaces:**
- Produces: шаблон с переменными `{{lesson_title}}`, `{{step_title}}`,
  `{{step_type}}`, `{{step_body}}`, `{{existing_check}}`, `{{findings}}`.

- [ ] **Step 1: Добавить имя промпта**

В `src/lib/agent/prompts.ts` в union `PromptName` дописать строку
`| "write-cards"` после `| "write-step"`.

- [ ] **Step 2: Написать `prompts/write-cards.md`**

```markdown
Ты пишешь вопросы для курса по AI-инженерии на русском языке.

Урок: {{lesson_title}}
Шаг: {{step_title}} (тип: {{step_type}})

Текст шага:

---
{{step_body}}
---

Существующие вопросы внутри шага (могут быть пустыми):

{{existing_check}}

Замечания к прошлой попытке (могут быть пустыми — тогда это первая попытка):

{{findings}}

## Что нужно сделать

Выдай два набора вопросов.

**Первый — `cards`: карточки повторения.** Их показывают через недели и месяцы
на отдельной странице, где текста этого шага рядом нет. Отсюда жёсткие
требования:

1. Карточка обязана быть понятной человеку, который этот шаг не видит.
   Никаких «выше», «в примере», «мы получили», «на этом шаге», «см. шаг 12».
2. Все числа в карточке обязаны отличаться от чисел в тексте шага. Если в шаге
   словарь из 65 символов и loss 4.17 — бери словарь из 1024 токенов и считай
   ответ заново. Проверяется автоматически: совпадение числа заворачивает
   карточку.
3. Карточка проверяет идею, а не память на пример.
4. Поле `concept` — одна фраза о том, какая именно идея проверяется. Две
   карточки урока не могут проверять одну идею.
5. Разнообразь виды. Пять доступных:
   - `choice` — вопрос и не меньше трёх вариантов, поле `correct` — индекс
     правильного с нуля;
   - `numeric` — числовой ответ, поля `answer` и `tolerance`;
   - `cloze` — строка кода или формула с пропуском `___` в поле `template`,
     правильная подстановка в `answer`, синонимы в `accept`;
   - `order` — поле `items`: шаги алгоритма в правильном порядке;
   - `open` — вопрос «объясни своими словами», эталон в поле `reference`.
6. На шаг — от одной до трёх карточек. Если шаг не несёт запоминаемой идеи
   (оглавление, переход, приглашение открыть редактор), верни пустой список.

**Второй — `check`: починенные вопросы внутри шага.** Их задают сразу после
чтения, поэтому опираться на контекст шага им можно. Нельзя другого: чтобы
правильным ответом было число, напечатанное в тексте шага. Вопрос «что значит
4.17» переделай в вопрос «почему стартовый loss равен логарифму размера
словаря». Формат прежний: `question`, `options` (не меньше трёх), `correct`,
`explanation`. Если существующих вопросов не было, верни пустой список — новых
не выдумывай.

У каждой карточки и каждого вопроса обязателен `explanation`: короткий разбор,
который человек читает после ответа. В разборе ссылаться на числа урока можно
и нужно.

## Формат ответа

Ответь одним блоком JSON и ничем больше:

```json
{
  "cards": [
    {
      "kind": "numeric",
      "concept": "стартовый loss равен натуральному логарифму размера словаря",
      "question": "Языковая модель ещё ничего не выучила и раскладывает вероятность поровну между всеми токенами. В словаре 1024 токена. Чему примерно равен кросс-энтропийный loss?",
      "answer": 6.93,
      "tolerance": 0.05,
      "explanation": "Равномерное распределение по |V| вариантам даёт loss ln(|V|). ln(1024) ≈ 6.93. Стартовый loss, заметно отличающийся от ln(|V|), означает ошибку в прямом проходе или в функции потерь."
    }
  ],
  "check": []
}
```
```

- [ ] **Step 3: Проверить, что промпт рендерится**

Run:
```bash
npx tsx -e "import {renderPrompt} from './src/lib/agent/prompts.js'; console.log(renderPrompt('write-cards',{lesson_title:'A',step_title:'B',step_type:'theory',step_body:'C',existing_check:'',findings:''}).slice(0,80))"
```
Expected: печатает начало промпта без исключения о непереданной переменной.

- [ ] **Step 4: Коммит**

```bash
git add prompts/write-cards.md src/lib/agent/prompts.ts
git commit -m "feat(cards): add the card generation prompt"
```

---

### Task 5: Проход генерации

**Files:**
- Create: `src/lib/generate/write-cards.ts`
- Test: `src/lib/generate/write-cards.test.ts`

**Interfaces:**
- Consumes: `GenerateDeps` и `extractJsonBlock` из
  `src/lib/generate/plan-lesson.ts`; `renderPrompt`; `Step`, `checkSchema`,
  `writeStep` из `src/lib/content/step-file.ts`; `cardDraftSchema`,
  `withFingerprints`, `writeCards`; `auditStep`, `auditCheck`,
  `formatFindings`.
- Produces:
  - `parseCardsReply(reply: string): { cards: CardDraft[]; check: CheckQuestion[] }`
  - `writeCardsForStep(opts): Promise<StepCardsResult>` где
    `interface StepCardsResult { stepId: string; cards: Card[]; check: CheckQuestion[]; findings: Finding[] }`

- [ ] **Step 1: Написать падающие тесты на подставном агенте**

Создать `src/lib/generate/write-cards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCards } from "../cards/card";
import type { Step } from "../content/step-file";
import { parseCardsReply, writeCardsForStep } from "./write-cards";

const SLUG = "01-math__01-alpha";

const STEP: Step = {
  id: "046-quiz",
  type: "theory",
  title: "Стартовый loss",
  body: "Стартовый loss при словаре из 65 символов равен примерно 4.17.",
};

const GOOD = JSON.stringify({
  cards: [
    {
      kind: "numeric",
      concept: "стартовый loss равен логарифму размера словаря",
      question: "В словаре 1024 токена, модель необучена. Чему примерно равен loss?",
      answer: 6.93,
      tolerance: 0.05,
      explanation: "ln(1024) ≈ 6.93.",
    },
  ],
  check: [],
});

const RECYCLED = JSON.stringify({
  cards: [
    {
      kind: "numeric",
      concept: "стартовый loss равен логарифму размера словаря",
      question: "В словаре 65 символов. Чему равен loss?",
      answer: 4.17,
      tolerance: 0.01,
      explanation: "ln(65) ≈ 4.17.",
    },
  ],
  check: [],
});

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "write-cards-"));
}

function agent(replies: string[]) {
  const prompts: string[] = [];
  return {
    prompts,
    deps: {
      run: async (prompt: string) => {
        prompts.push(prompt);
        return replies[prompts.length - 1] ?? replies[replies.length - 1];
      },
    },
  };
}

describe("parseCardsReply", () => {
  it("достаёт JSON из ответа, обрамлённого текстом", () => {
    const parsed = parseCardsReply(`Вот карточки:\n\`\`\`json\n${GOOD}\n\`\`\`\nГотово.`);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.check).toEqual([]);
  });

  it("на мусоре вместо JSON возвращает пустые списки, а не бросает", () => {
    expect(parseCardsReply("Извини, не понял задачу.")).toEqual({ cards: [], check: [] });
  });
});

describe("writeCardsForStep", () => {
  it("пишет карточки на диск и не жалуется", async () => {
    const dir = tmpDir();
    const { deps } = agent([GOOD]);
    const result = await writeCardsForStep({ contentDir: dir, slug: SLUG, step: STEP, deps });

    expect(result.findings).toEqual([]);
    expect(result.cards).toHaveLength(1);
    expect(readCards(dir, SLUG, "046-quiz")).toHaveLength(1);
  });

  it("переспрашивает один раз, отдав замечания, и принимает исправленное", async () => {
    const dir = tmpDir();
    const { deps, prompts } = agent([RECYCLED, GOOD]);
    const result = await writeCardsForStep({ contentDir: dir, slug: SLUG, step: STEP, deps });

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("number-overlap");
    expect(result.findings).toEqual([]);
    expect(readCards(dir, SLUG, "046-quiz")).toHaveLength(1);
  });

  it("на повторном провале ничего не пишет и возвращает замечания", async () => {
    const dir = tmpDir();
    const { deps } = agent([RECYCLED, RECYCLED]);
    const result = await writeCardsForStep({ contentDir: dir, slug: SLUG, step: STEP, deps });

    expect(result.findings.map((f) => f.rule)).toContain("number-overlap");
    expect(result.cards).toEqual([]);
    expect(readCards(dir, SLUG, "046-quiz")).toBeNull();
  });

  it("пустой список карточек — законный ответ для шага без запоминаемой идеи", async () => {
    const dir = tmpDir();
    const { deps } = agent([JSON.stringify({ cards: [], check: [] })]);
    const result = await writeCardsForStep({ contentDir: dir, slug: SLUG, step: STEP, deps });

    expect(result.cards).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(readCards(dir, SLUG, "046-quiz")).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run src/lib/generate/write-cards.test.ts`
Expected: FAIL, `Failed to resolve import "./write-cards"`.

- [ ] **Step 3: Написать `src/lib/generate/write-cards.ts`**

```ts
import { z } from "zod";
import type { AgentEvent } from "../agent/events";
import { renderPrompt } from "../agent/prompts";
import {
  auditCheck,
  auditStep,
  formatFindings,
  type Finding,
} from "../cards/audit";
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
 * списками, а не исключением. Причина та же, что у `parseStepReply`: один
 * невнятный ответ посреди фазы не должен ронять прогон на четырёхстах уроках.
 * Пустые списки означают «карточек нет», и это видно в отчёте.
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

function buildPrompt(
  lessonTitle: string,
  step: Step,
  findings: Finding[],
): string {
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
 * Повтор ровно один. Замечания уходят агенту вместе с исходным заданием; если
 * и вторая попытка не прошла аудит, на диск не пишется ничего и шаг попадает
 * в отчёт человеку. Писать забракованное «пока так» нельзя: карточка уедет в
 * график повторений и будет учить не тому.
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

    findings = [...auditStep(cards, step.body), ...auditCheck(check, step.body)];
    const blocking = findings.filter((finding) => finding.severity === "error");
    if (blocking.length) continue;

    const written = withFingerprints(cards, step.id);
    if (written.length) writeCards(contentDir, slug, step.id, written);
    return { stepId: step.id, cards: written, check, findings: findings };
  }

  return { stepId: step.id, cards: [], check: [], findings };
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run src/lib/generate/write-cards.test.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Прогнать весь набор — ничего не сломано**

Run: `npm test`
Expected: PASS, прежнее число тестов плюс новые.

- [ ] **Step 6: Коммит**

```bash
git add src/lib/generate/write-cards.ts src/lib/generate/write-cards.test.ts
git commit -m "feat(cards): generate cards and fixed check questions in one agent pass"
```

---

### Task 6: Драйвер записи

**Files:**
- Create: `scripts/write-cards.mts`
- Modify: `package.json` (скрипт `cards:write`)

**Interfaces:**
- Consumes: `writeCardsForStep`, `defaultDeps`, `loadConfig`, `readLessonPlan`,
  `readStepsById`, `writeStep`, `auditLesson`.
- Produces: команду `npm run cards:write -- <slug|--phase NN> [--agent claude|codex]`.

Перед реализацией прочитать `scripts/write-lesson.mts` целиком: разбор
аргументов, остановка по лимиту (код 2) и по трём таймаутам подряд (код 3)
копируются оттуда, а не изобретаются заново.

- [ ] **Step 1: Написать скрипт**

```ts
// Карточки повторения и починка вопросов — отдельным процессом.
//
// Запуск:
//   npm run cards:write -- <slug>
//   npm run cards:write -- --phase 01
//
// Своя очередь агента на процесс — по той же причине, что у write-lesson.mts:
// очередь живёт в модуле, и два процесса пишут два урока одновременно.
//
// Починенные вопросы `check` дописываются во фронтматтер шага через writeStep,
// карточки ложатся отдельным файлом. Шаг, у которого вопросов не было, не
// трогается вовсе: новых вопросов проход не выдумывает.
import { isLimitError, isTimeoutError } from "../src/lib/agent/error-message.js";
import { defaultDeps } from "../src/lib/agent/factory.js";
import { auditLesson } from "../src/lib/cards/audit.js";
import { loadConfig } from "../src/lib/config.js";
import { readLessonPlan } from "../src/lib/content/lesson-plan.js";
import { readStepsById, writeStep } from "../src/lib/content/step-file.js";
import { writeCardsForStep } from "../src/lib/generate/write-cards.js";

const MAX_TIMEOUTS_IN_ROW = 3;

interface Report {
  slug: string;
  steps: number;
  cards: number;
  fixedCheck: number;
  rejected: { stepId: string; rules: string[] }[];
}

async function writeLessonCards(
  contentDir: string,
  slug: string,
  agent: "claude" | "codex" | null,
): Promise<Report> {
  const plan = readLessonPlan(contentDir, slug);
  if (!plan) throw new Error(`Нет плана урока ${slug}`);

  const ids = plan.steps.map((step) => step.id);
  const steps = readStepsById(contentDir, slug, ids);
  const report: Report = { slug, steps: 0, cards: 0, fixedCheck: 0, rejected: [] };
  const lessonCards = [];

  for (const id of ids) {
    const step = steps[id];
    if (!step) continue;

    const deps = defaultDeps(loadConfig(), agent ? { agent } : {});
    const result = await writeCardsForStep({
      contentDir,
      slug,
      step,
      deps,
      lessonTitle: plan.title,
    });

    report.steps += 1;
    if (result.cards.length) {
      report.cards += result.cards.length;
      lessonCards.push(...result.cards);
    }
    if (result.check.length && step.check?.length) {
      writeStep(contentDir, slug, { ...step, check: result.check });
      report.fixedCheck += 1;
    }
    if (result.findings.some((finding) => finding.severity === "error")) {
      report.rejected.push({
        stepId: id,
        rules: [...new Set(result.findings.map((finding) => finding.rule))],
      });
    }
  }

  // Правила уровня урока считаются после всех шагов: одна карточка про ту же
  // идею, что и карточка соседнего шага, видна только отсюда.
  for (const finding of auditLesson(lessonCards)) {
    console.warn(`[${slug}] ${finding.rule}: ${finding.message}`);
  }

  return report;
}

function printReport(report: Report): void {
  console.log(
    `${report.slug}: шагов ${report.steps}, карточек ${report.cards}, ` +
      `починено вопросов ${report.fixedCheck}, забраковано шагов ${report.rejected.length}`,
  );
  for (const item of report.rejected) {
    console.log(`  ${item.stepId}: ${item.rules.join(", ")}`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { slugs, agent } = parseArgs(process.argv.slice(2));
  let timeoutsInRow = 0;

  for (const slug of slugs) {
    try {
      printReport(await writeLessonCards(config.contentDir, slug, agent));
      timeoutsInRow = 0;
    } catch (error) {
      if (isLimitError(error)) {
        console.error("Лимит исчерпан, останавливаюсь");
        process.exit(2);
      }
      if (isTimeoutError(error)) {
        timeoutsInRow += 1;
        if (timeoutsInRow >= MAX_TIMEOUTS_IN_ROW) {
          console.error("Три таймаута подряд — сеть лежит, останавливаюсь");
          process.exit(3);
        }
        continue;
      }
      throw error;
    }
  }
}

void main();
```

`parseArgs` скопировать из `scripts/write-lesson.mts` без изменений, кроме
удаления неиспользуемого `--from`.

- [ ] **Step 2: Добавить npm-скрипт**

В `package.json` в `scripts` после `audit:phase19`:

```json
    "cards:write": "tsx --env-file-if-exists=.env.local scripts/write-cards.mts",
```

- [ ] **Step 3: Проверить разбор аргументов без вызова агента**

Run: `npm run cards:write -- --phase 99`
Expected: скрипт отработает и ничего не сделает — уроков фазы 99 нет. Ошибок
разбора аргументов быть не должно.

- [ ] **Step 4: Прогнать на одном настоящем уроке**

Run: `npm run cards:write -- 01-math-foundations__01-linear-algebra-intuition`
Expected: печатает отчёт; в `content/lessons/<slug>/cards/` появляются файлы.
Открыть два-три и прочитать глазами: числа отличаются от чисел урока, вопрос
понятен без текста шага.

- [ ] **Step 5: Коммит**

```bash
git add scripts/write-cards.mts package.json
git commit -m "feat(cards): add the card writing driver"
```

---

### Task 7: Проверяющий проход и ворота между фазами

**Files:**
- Create: `src/lib/content/lessons.ts`
- Test: `src/lib/content/lessons.test.ts`
- Modify: `scripts/build-site.mts:144-152` (убрать местную копию)
- Create: `scripts/audit-cards.mts`
- Modify: `package.json` (скрипт `audit:cards`)

**Interfaces:**
- Consumes: `readCards`, `auditStep`, `auditLesson`, `auditCheck`,
  `readLessonPlan`, `readStepsById`.
- Produces:
  - `lessonSlugs(contentDir: string): string[]` из `src/lib/content/lessons.ts`
  - команду `npm run audit:cards [-- --phase NN]`, код возврата 1 при ошибках.

Перед реализацией прочитать `scripts/audit-lessons.mjs`: формат отчёта и код
возврата копируются оттуда.

- [ ] **Step 1: Вынести `lessonSlugs` в `src/lib`**

Сейчас это приватная функция в `scripts/build-site.mts:144`, закрывающая
модульную переменную `contentDir`. Потребителей стало два, поэтому она
переезжает в общее место и принимает каталог аргументом.

Написать падающий тест `src/lib/content/lessons.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lessonSlugs } from "./lessons";

describe("lessonSlugs", () => {
  it("возвращает каталоги уроков по алфавиту", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lessons-"));
    fs.mkdirSync(path.join(dir, "lessons", "02-beta"), { recursive: true });
    fs.mkdirSync(path.join(dir, "lessons", "01-alpha"), { recursive: true });
    fs.writeFileSync(path.join(dir, "lessons", "note.txt"), "не урок");
    expect(lessonSlugs(dir)).toEqual(["01-alpha", "02-beta"]);
  });

  it("на отсутствующем каталоге возвращает пустой список, а не бросает", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lessons-"));
    expect(lessonSlugs(dir)).toEqual([]);
  });
});
```

Run: `npx vitest run src/lib/content/lessons.test.ts` — FAIL, модуля нет.

Создать `src/lib/content/lessons.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

/**
 * Слаги уроков — по каталогам на диске, а не по индексу.
 *
 * Индекса уроков в проекте нет намеренно: уроки появляются импортом по одному,
 * и каталог на диске всегда честнее любого списка, который надо не забыть
 * обновить.
 */
export function lessonSlugs(contentDir: string): string[] {
  const lessonsDir = path.join(contentDir, "lessons");
  if (!fs.existsSync(lessonsDir)) return [];
  return fs
    .readdirSync(lessonsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
```

Run: `npx vitest run src/lib/content/lessons.test.ts` — PASS.

В `scripts/build-site.mts` удалить местную функцию, добавить импорт
`import { lessonSlugs } from "../src/lib/content/lessons.js";` и заменить
вызовы `lessonSlugs()` на `lessonSlugs(contentDir)`.

Run: `npm run site:build`
Expected: сборка проходит, число страниц прежнее.

Коммит:

```bash
git add src/lib/content/lessons.ts src/lib/content/lessons.test.ts scripts/build-site.mts
git commit -m "refactor(content): lift lessonSlugs out of the site build"
```

- [ ] **Step 2: Написать скрипт**

```ts
// Проверка уже написанных карточек и вопросов — без агента.
//
// Запуск:
//   npm run audit:cards
//   npm run audit:cards -- --phase 01
//
// Это ворота между фазами: прогон по фазе, отчёт, глаза, «дальше». Код 1 при
// хотя бы одной ошибке; предупреждения на код возврата не влияют.
import { auditCheck, auditLesson, auditStep, type Finding } from "../src/lib/cards/audit.js";
import { readCards } from "../src/lib/cards/card.js";
import { loadConfig } from "../src/lib/config.js";
import { readLessonPlan } from "../src/lib/content/lesson-plan.js";
import { readStepsById } from "../src/lib/content/step-file.js";
import { lessonSlugs } from "../src/lib/content/lessons.js";

function auditLessonFiles(contentDir: string, slug: string): Finding[] {
  const plan = readLessonPlan(contentDir, slug);
  if (!plan) return [];

  const ids = plan.steps.map((step) => step.id);
  const steps = readStepsById(contentDir, slug, ids);
  const findings: Finding[] = [];
  const lessonCards = [];

  for (const id of ids) {
    const step = steps[id];
    if (!step) continue;

    const cards = readCards(contentDir, slug, id);
    if (cards) {
      findings.push(...auditStep(cards, step.body));
      lessonCards.push(...cards);
    }
    if (step.check?.length) findings.push(...auditCheck(step.check, step.body));
  }

  findings.push(...auditLesson(lessonCards));
  return findings;
}

function main(): void {
  const config = loadConfig();
  const phase = process.argv.includes("--phase")
    ? process.argv[process.argv.indexOf("--phase") + 1]
    : null;

  let errors = 0;
  let warnings = 0;

  for (const slug of lessonSlugs(config.contentDir)) {
    if (phase && !slug.startsWith(`${phase}-`)) continue;
    const findings = auditLessonFiles(config.contentDir, slug);
    if (!findings.length) continue;

    console.log(slug);
    for (const finding of findings) {
      console.log(`  [${finding.severity}] ${finding.rule} (${finding.cardId}): ${finding.message}`);
      if (finding.severity === "error") errors += 1;
      else warnings += 1;
    }
  }

  console.log(`Ошибок: ${errors}, предупреждений: ${warnings}`);
  if (errors) process.exit(1);
}

main();
```

- [ ] **Step 3: Добавить npm-скрипт**

В `package.json` рядом с `audit:lessons`:

```json
    "audit:cards": "tsx scripts/audit-cards.mts",
```

- [ ] **Step 4: Прогнать по фазе, для которой карточки уже написаны**

Run: `npm run audit:cards -- --phase 01`
Expected: печатает отчёт и «Ошибок: 0» — иначе разбирать каждую ошибку руками.

- [ ] **Step 5: Прогнать по всему курсу**

Run: `npm run audit:cards`
Expected: не падает на уроках без карточек — отсутствие файла не ошибка.

- [ ] **Step 6: Коммит**

```bash
git add scripts/audit-cards.mts package.json
git commit -m "feat(cards): add the card audit pass used as a phase gate"
```

---

### Task 8: Первая фаза и ворота

**Files:**
- Modify: `content/lessons/01-*/cards/*.yml` (создаются прогоном)
- Modify: `content/lessons/01-*/steps/*.md` (починенные `check`)
- Modify: `README.md` (раздел «Что где» и «Ограничения текущего среза»)

- [ ] **Step 1: Прогнать фазу 1 целиком**

Run: `npm run cards:write -- --phase 01`
Expected: отчёт по каждому уроку. Забракованных шагов ожидается немного;
если их больше десятой части — остановиться и править `prompts/write-cards.md`,
а не гнать дальше.

- [ ] **Step 2: Прогнать аудит по фазе**

Run: `npm run audit:cards -- --phase 01`
Expected: «Ошибок: 0».

- [ ] **Step 3: Прочитать диф глазами**

Run: `git diff --stat` и выборочно `git diff content/lessons/01-math-foundations__07-bayes-theorem/`

Смотреть ровно на то, ради чего всё затеяно: числа в карточке отличаются от
чисел урока, вопрос читается без текста шага, починенный `check` спрашивает про
идею, а не про число.

- [ ] **Step 4: Обновить README**

В разделе «Что где» дописать строку про `content/lessons/<slug>/cards/`. В
разделе «Ограничения текущего среза» убрать утверждение, что вопросов `check`
нет ни на одном шаге: оно неверно уже сейчас — их несут 2859 файлов.

- [ ] **Step 5: Коммит**

```bash
git add content/lessons README.md
git commit -m "content(cards): write review cards for phase 01"
```

- [ ] **Step 6: Ворота**

Показать отчёт и диф человеку. Дальше по фазам той же парой команд, по коммиту
на фазу. Следующая фаза не запускается, пока предыдущая не принята.

---

## Self-Review

**Покрытие спеки.** Форма карточки и пять видов — Task 1. `fingerprint` и его
поведение при правке разбора — Task 1. Шесть правил аудита — Task 2 (седьмое
правило спеки живёт в схеме, отклонение объяснено в Task 2). Правила для
`check` — Task 3. Промпт — Task 4. Один вызов агента на оба набора, повтор с
findings, отказ писать забракованное — Task 5. Драйвер и отчёт — Task 6.
Ворота между фазами — Task 7 и Task 8. Явная зависимость `js-yaml` — Task 1,
шаг 1.

**Что осталось за планом сознательно.** Выгрузка `cards/<slug>.json` в
`scripts/build-site.mts` — она принадлежит режиму повторений и живёт в его
плане: без страницы `/review/` эти файлы никто не читает.
