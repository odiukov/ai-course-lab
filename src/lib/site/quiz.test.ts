import { describe, expect, it } from "vitest";
import type { Step } from "../content/step-file";
import { encodeQuizPayload, quizQuestions } from "./quiz";

function step(overrides: Partial<Step> = {}): Step {
  return { id: "010-check", type: "check", title: "Проверка", body: "", ...overrides };
}

describe("quizQuestions", () => {
  it("carries the correct index and the explanation", () => {
    const questions = quizQuestions(
      step({
        check: [
          {
            question: "Наклон x^2 в точке 3?",
            options: ["3", "6", "9"],
            correct: 1,
            explanation: "Производная 2x, при x=3 это 6.",
          },
        ],
      }),
    );

    expect(questions).toEqual([
      {
        question: "Наклон x^2 в точке 3?",
        options: ["3", "6", "9"],
        correct: 1,
        explanation: "Производная 2x, при x=3 это 6.",
      },
    ]);
  });

  it("returns nothing for a step without questions", () => {
    expect(quizQuestions(step({ type: "theory" }))).toEqual([]);
  });
});

describe("encodeQuizPayload", () => {
  it("escapes markup so a question cannot close the script tag", () => {
    const encoded = encodeQuizPayload([
      {
        question: "Что делает </script> в тексте?",
        options: ["A", "B"],
        correct: 0,
        explanation: "",
      },
    ]);

    expect(encoded).not.toContain("</script>");
    expect(JSON.parse(encoded)[0].question).toBe("Что делает </script> в тексте?");
  });
});
