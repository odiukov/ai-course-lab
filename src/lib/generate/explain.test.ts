import { describe, expect, it, vi } from "vitest";
import type { Step } from "../content/step-file";
import { buildExplainPrompt, explainStep, MAX_STEP_BODY } from "./explain";

const STEP: Step = {
  id: "016-matmul-theory",
  type: "theory",
  title: "Матричное умножение",
  body: "Внутренние размерности должны совпадать.",
};

describe("buildExplainPrompt", () => {
  it("собирает промпт из шага, уточнений, истории и вопроса", () => {
    const prompt = buildExplainPrompt({
      lessonTitle: "Векторы и матрицы",
      step: STEP,
      clarifications: "- «Что такое столбец?» (шаг: Матрица)",
      history: "Ученик: а раньше?\nТы: раньше был вектор.",
      question: "А почему именно внутренние?",
    });

    expect(prompt).toContain("Векторы и матрицы");
    expect(prompt).toContain("Матричное умножение");
    expect(prompt).toContain("Внутренние размерности должны совпадать.");
    expect(prompt).toContain("Что такое столбец?");
    expect(prompt).toContain("раньше был вектор");
    expect(prompt).toContain("А почему именно внутренние?");
    expect(prompt).not.toContain("{{");
  });

  it("обрезает слишком длинное тело шага", () => {
    const prompt = buildExplainPrompt({
      lessonTitle: "Векторы и матрицы",
      step: { ...STEP, body: "я".repeat(MAX_STEP_BODY * 2) },
      clarifications: "(вопросов по этому уроку ещё не было)",
      history: "(это первый вопрос в этом чате)",
      question: "Почему?",
    });

    expect(prompt).toContain("…");
    expect(prompt.length).toBeLessThan(MAX_STEP_BODY + 3000);
  });
});

describe("explainStep", () => {
  it("возвращает подчищенный ответ и прокидывает текстовые события", async () => {
    const seen: string[] = [];
    const run = vi.fn().mockResolvedValue("  Потому что строка идёт по столбцу.  ");

    const text = await explainStep({
      request: {
        lessonTitle: "Векторы и матрицы",
        step: STEP,
        clarifications: "(вопросов по этому уроку ещё не было)",
        history: "(это первый вопрос в этом чате)",
        question: "А почему именно внутренние?",
      },
      deps: { run },
      onEvent: (event) => {
        if (event.type === "text") seen.push(event.text);
      },
    });

    expect(text).toBe("Потому что строка идёт по столбцу.");
    expect(run).toHaveBeenCalledTimes(1);

    const forward = run.mock.calls[0][1] as (event: { type: "text"; text: string }) => void;
    forward({ type: "text", text: "кусок" });
    expect(seen).toEqual(["кусок"]);
  });

  it("снимает markdown-забор, в который агент завернул весь ответ", async () => {
    const run = vi
      .fn()
      .mockResolvedValue("```markdown\nПотому что строка идёт по столбцу.\n\n$A B$ — произведение.\n```");

    const text = await explainStep({
      request: {
        lessonTitle: "Векторы и матрицы",
        step: STEP,
        clarifications: "(вопросов по этому уроку ещё не было)",
        history: "(это первый вопрос в этом чате)",
        question: "Почему?",
      },
      deps: { run },
    });

    expect(text).toBe("Потому что строка идёт по столбцу.\n\n$A B$ — произведение.");
  });

  it("оставляет ответ, который сам начинается с блока кода", async () => {
    const answer = "```python\nA @ B\n```\n\nЗдесь `@` — это матричное умножение.";
    const run = vi.fn().mockResolvedValue(answer);

    const text = await explainStep({
      request: {
        lessonTitle: "Векторы и матрицы",
        step: STEP,
        clarifications: "(вопросов по этому уроку ещё не было)",
        history: "(это первый вопрос в этом чате)",
        question: "Почему?",
      },
      deps: { run },
    });

    expect(text).toBe(answer);
  });

  it("падает, если агент вернул пустой ответ", async () => {
    const run = vi.fn().mockResolvedValue("   ");
    await expect(
      explainStep({
        request: {
          lessonTitle: "Векторы и матрицы",
          step: STEP,
          clarifications: "(вопросов по этому уроку ещё не было)",
          history: "(это первый вопрос в этом чате)",
          question: "Почему?",
        },
        deps: { run },
      }),
    ).rejects.toThrow(/пустой/i);
  });

  it("падает, если внутри забора не осталось текста", async () => {
    const run = vi.fn().mockResolvedValue("```markdown\n\n```");
    await expect(
      explainStep({
        request: {
          lessonTitle: "Векторы и матрицы",
          step: STEP,
          clarifications: "(вопросов по этому уроку ещё не было)",
          history: "(это первый вопрос в этом чате)",
          question: "Почему?",
        },
        deps: { run },
      }),
    ).rejects.toThrow(/пустой/i);
  });
});
