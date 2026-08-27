import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
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

/**
 * Убирает карточки шага с диска.
 *
 * Нужна перегенерации: шаг, который раньше давал карточки, а теперь честно
 * возвращает пустой список (мотивационный раздел, переход, оглавление), иначе
 * сохранил бы прежний файл навсегда — писать-то нечего, а старое никто не
 * трогал. Именно так на сайте пережила бы починку карточка, выросшая из нашей
 * метафоры вместо предмета урока.
 */
export function removeCards(contentDir: string, slug: string, stepId: string): void {
  fs.rmSync(lessonPaths(contentDir, slug).cardsFile(stepId), { force: true });
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
