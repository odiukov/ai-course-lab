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
