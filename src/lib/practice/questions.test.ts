import { describe, expect, it } from "vitest";
import type { Step } from "@/lib/content/step-file";
import type { LessonSource } from "@/lib/source/lesson-source";
import {
  allAnsweredCorrectly,
  finalQuizQuestions,
  gradeAnswer,
  stepQuestions,
  toPublicQuestions,
  toPublicStep,
} from "./questions";

const source = {
  quiz: [
    { stage: "pre", question: "до урока", options: ["a", "b"], correct: 0, explanation: "" },
    { stage: "post", question: "после урока", options: ["a", "b"], correct: 1, explanation: "потому что" },
  ],
} as unknown as LessonSource;

const questions = [
  { question: "1?", options: ["a", "b"], correct: 1, explanation: "б верно" },
  { question: "2?", options: ["c", "d"], correct: 0, explanation: "в верно" },
];

describe("finalQuizQuestions", () => {
  it("берёт только вопросы не из стадии pre", () => {
    expect(finalQuizQuestions(source).map((item) => item.question)).toEqual(["после урока"]);
  });

  it("если post-вопросов нет, берёт все — пустой квиз хуже неточного", () => {
    const onlyPre = { quiz: [source.quiz[0]] } as unknown as LessonSource;
    expect(finalQuizQuestions(onlyPre)).toHaveLength(1);
  });
});

describe("stepQuestions", () => {
  it("для check-шага берёт вопросы из его frontmatter", () => {
    const step = { type: "check", check: questions } as unknown as Step;
    expect(stepQuestions(step, source)).toHaveLength(2);
  });

  it("для quiz-шага берёт итоговый квиз урока", () => {
    const step = { type: "quiz" } as unknown as Step;
    expect(stepQuestions(step, source).map((item) => item.question)).toEqual(["после урока"]);
  });

  it("для остальных типов шага вопросов нет", () => {
    expect(stepQuestions({ type: "theory" } as unknown as Step, source)).toEqual([]);
  });
});

describe("toPublicQuestions", () => {
  it("правильный ответ наружу не уходит", () => {
    expect(toPublicQuestions(questions)).toEqual([
      { question: "1?", options: ["a", "b"] },
      { question: "2?", options: ["c", "d"] },
    ]);
  });
});

describe("gradeAnswer", () => {
  it("верный ответ", () => {
    expect(gradeAnswer(questions, 0, 1)).toEqual({ correct: true, correctIndex: 1, explanation: "б верно" });
  });

  it("неверный ответ отдаёт правильный индекс и объяснение", () => {
    expect(gradeAnswer(questions, 0, 0)).toMatchObject({ correct: false, correctIndex: 1 });
  });

  it("вопрос за пределами набора — ошибка, а не молчаливое «неверно»", () => {
    expect(() => gradeAnswer(questions, 7, 0)).toThrow(/вопрос/i);
  });

  it("вариант за пределами списка — тоже ошибка", () => {
    expect(() => gradeAnswer(questions, 0, 9)).toThrow(/вариант/i);
  });
});

describe("allAnsweredCorrectly", () => {
  it("верно, когда по каждому вопросу последний ответ верный", () => {
    const latest = new Map([
      [0, { correct: true }],
      [1, { correct: true }],
    ]);
    expect(allAnsweredCorrectly(questions, latest)).toBe(true);
  });

  it("неотвеченный вопрос не даёт пройденного шага", () => {
    expect(allAnsweredCorrectly(questions, new Map([[0, { correct: true }]]))).toBe(false);
  });

  it("неверный последний ответ не даёт пройденного шага", () => {
    const latest = new Map([
      [0, { correct: true }],
      [1, { correct: false }],
    ]);
    expect(allAnsweredCorrectly(questions, latest)).toBe(false);
  });
});

describe("toPublicStep", () => {
  const checkStep: Step = {
    id: "005-check",
    type: "check",
    title: "Проверка",
    body: "Тело.",
    check: [
      { question: "Длина [6, 8]?", options: ["7", "10"], correct: 1, explanation: "36 + 64 = 100." },
    ],
  };

  it("снимает верный ответ и объяснение: их знает только сервер", () => {
    const publicStep = toPublicStep(checkStep);
    expect(publicStep.check).toEqual([{ question: "Длина [6, 8]?", options: ["7", "10"] }]);
    expect(JSON.stringify(publicStep)).not.toContain("correct");
    expect(JSON.stringify(publicStep)).not.toContain("36 + 64");
  });

  it("остальные поля шага остаются на месте", () => {
    expect(toPublicStep(checkStep)).toMatchObject({ id: "005-check", type: "check", body: "Тело." });
  });

  it("шаг без вопросов проходит как есть и поля check не приобретает", () => {
    const step: Step = { id: "001-t", type: "theory", title: "Зачем", body: "Тело." };
    expect(toPublicStep(step)).toEqual(step);
    expect("check" in toPublicStep(step)).toBe(false);
  });
});
