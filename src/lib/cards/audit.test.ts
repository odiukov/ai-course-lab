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
