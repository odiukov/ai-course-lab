import { describe, expect, it } from "vitest";
import { renderPrompt } from "./prompts";

describe("renderPrompt — write-step", () => {
  it("подставляет переменные", () => {
    const out = renderPrompt("write-step", {
      lesson_title: "Бета",
      step_title: "Транспонирование",
      step_type: "theory",
      source_excerpt: "текст урока",
      neighbours: "предыдущий шаг",
      clarifications: "- «Что такое строка матрицы?» (шаг: Матрица)",
    });
    expect(out).toContain("Транспонирование");
    expect(out).toContain("текст урока");
    expect(out).toContain("Что такое строка матрицы?");
    expect(out).not.toContain("{{");
  });

  it("падает, если переменная не передана", () => {
    expect(() => renderPrompt("write-step", { lesson_title: "Бета" })).toThrow(/step_title/);
  });

  it("требует уточнения — молча пустым местом их не заменить", () => {
    expect(() =>
      renderPrompt("write-step", {
        lesson_title: "Бета",
        step_title: "Транспонирование",
        step_type: "theory",
        source_excerpt: "текст урока",
        neighbours: "предыдущий шаг",
      }),
    ).toThrow(/clarifications/);
  });
});

describe("renderPrompt — explain", () => {
  it("подставляет шаг, историю и вопрос", () => {
    const out = renderPrompt("explain", {
      lesson_title: "Бета",
      step_title: "Матричное умножение",
      step_type: "theory",
      step_body: "Внутренние размерности должны совпадать.",
      clarifications: "(вопросов по этому уроку ещё не было)",
      history: "(это первый вопрос)",
      question: "А почему именно внутренние?",
    });
    expect(out).toContain("Матричное умножение");
    expect(out).toContain("Внутренние размерности должны совпадать.");
    expect(out).toContain("А почему именно внутренние?");
    expect(out).not.toContain("{{");
  });

  it("падает, если не передан вопрос", () => {
    expect(() =>
      renderPrompt("explain", {
        lesson_title: "Бета",
        step_title: "Матричное умножение",
        step_type: "theory",
        step_body: "Тело шага.",
        clarifications: "(вопросов по этому уроку ещё не было)",
        history: "(это первый вопрос)",
      }),
    ).toThrow(/question/);
  });
});
