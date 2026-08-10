import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendClarification } from "./clarifications";
import type { StepMeta } from "./step-file";
import {
  buildClarificationContext,
  MAX_QUESTIONS,
  NO_CLARIFICATIONS,
} from "./clarification-context";

const SLUG = "01-math-foundations__02-beta";

const STEPS: StepMeta[] = [
  { id: "001-t", type: "theory", title: "Зачем" },
  { id: "002-t", type: "theory", title: "Вектор" },
  { id: "003-t", type: "theory", title: "Матрица" },
];

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clar-ctx-"));
}

describe("buildClarificationContext", () => {
  it("без уточнений честно говорит, что вопросов не было", () => {
    const text = buildClarificationContext({
      contentDir: tmpDir(),
      slug: SLUG,
      steps: STEPS,
      beforeStepId: "003-t",
    });
    expect(text).toBe(NO_CLARIFICATIONS);
  });

  it("берёт только шаги до текущего", () => {
    const contentDir = tmpDir();
    appendClarification(contentDir, SLUG, "001-t", {
      askedAt: "2026-08-10T09:00:00.000Z",
      question: "Ранний вопрос",
      answer: "Ранний ответ",
    });
    appendClarification(contentDir, SLUG, "003-t", {
      askedAt: "2026-08-10T10:00:00.000Z",
      question: "Поздний вопрос",
      answer: "Поздний ответ",
    });

    const text = buildClarificationContext({
      contentDir,
      slug: SLUG,
      steps: STEPS,
      beforeStepId: "003-t",
    });
    expect(text).toContain("Ранний вопрос");
    expect(text).not.toContain("Поздний вопрос");
  });

  it("с includeCurrent берёт и текущий шаг", () => {
    const contentDir = tmpDir();
    appendClarification(contentDir, SLUG, "003-t", {
      askedAt: "2026-08-10T10:00:00.000Z",
      question: "Поздний вопрос",
      answer: "Поздний ответ",
    });

    const text = buildClarificationContext({
      contentDir,
      slug: SLUG,
      steps: STEPS,
      beforeStepId: "003-t",
      includeCurrent: true,
    });
    expect(text).toContain("Поздний вопрос");
  });

  it("схлопывает повторяющийся вопрос", () => {
    const contentDir = tmpDir();
    appendClarification(contentDir, SLUG, "001-t", {
      askedAt: "2026-08-10T09:00:00.000Z",
      question: "Что такое вектор?",
      answer: "Список чисел.",
    });
    appendClarification(contentDir, SLUG, "002-t", {
      askedAt: "2026-08-10T09:30:00.000Z",
      question: "что такое ВЕКТОР?",
      answer: "Всё ещё список чисел.",
    });

    const text = buildClarificationContext({
      contentDir,
      slug: SLUG,
      steps: STEPS,
      beforeStepId: "003-t",
    });
    const bullets = text.split("\n").filter((line) => line.startsWith("- «"));
    expect(bullets).toHaveLength(1);
  });

  it("не превышает потолок в 12 вопросов даже на сорока уточнениях", () => {
    const contentDir = tmpDir();
    for (let i = 0; i < 40; i += 1) {
      appendClarification(contentDir, SLUG, "001-t", {
        askedAt: `2026-08-10T09:${String(i).padStart(2, "0")}:00.000Z`,
        question: `Вопрос номер ${i}`,
        answer: `Ответ номер ${i}`,
      });
    }

    const text = buildClarificationContext({
      contentDir,
      slug: SLUG,
      steps: STEPS,
      beforeStepId: "003-t",
    });
    const bullets = text.split("\n").filter((line) => line.startsWith("- «"));
    expect(bullets.length).toBeLessThanOrEqual(MAX_QUESTIONS);
    expect(text.length).toBeLessThan(3000);
    expect(text).toContain("Вопрос номер 39");
    expect(text).not.toContain("Вопрос номер 0»");
  });

  it("показывает последнее уточнение целиком и обрезает длинный ответ", () => {
    const contentDir = tmpDir();
    appendClarification(contentDir, SLUG, "001-t", {
      askedAt: "2026-08-10T09:00:00.000Z",
      question: "Почему так длинно?",
      answer: "я".repeat(5000),
    });

    const text = buildClarificationContext({
      contentDir,
      slug: SLUG,
      steps: STEPS,
      beforeStepId: "003-t",
    });
    expect(text).toContain("Последнее уточнение целиком:");
    expect(text).toContain("…");
    expect(text.length).toBeLessThan(2500);
  });

  it("остаётся в пределах потолка даже на двухстах уточнениях по тысяче символов в каждом поле", () => {
    const contentDir = tmpDir();
    for (let i = 0; i < 200; i += 1) {
      appendClarification(contentDir, SLUG, "001-t", {
        askedAt: `2026-08-10T${String(9 + Math.floor(i / 60)).padStart(2, "0")}:${String(
          i % 60,
        ).padStart(2, "0")}:00.000Z`,
        // ~1000 символов и в вопросе, и в ответе — прямая проверка условия
        // из задачи ("двести уточнений по тысяче символов").
        question: `Уникальный вопрос номер ${i} ${"вопрос ".repeat(140)}`,
        answer: `Ответ номер ${i} ${"о".repeat(990)}`,
      });
    }

    const text = buildClarificationContext({
      contentDir,
      slug: SLUG,
      steps: STEPS,
      beforeStepId: "003-t",
    });

    // Абсолютный потолок независим от размера входа: сумма бюджетов на
    // список вопросов (MAX_QUESTIONS_CHARS), на вопрос в блоке "целиком"
    // и на ответ в нём (MAX_FULL_CHARS), плюс постоянные заголовки —
    // никакого множителя от количества или длины входных уточнений.
    expect(text.length).toBeLessThan(3000);
    const bullets = text.split("\n").filter((line) => line.startsWith("- «"));
    expect(bullets.length).toBeLessThanOrEqual(MAX_QUESTIONS);
    // выживает самое новое, а не произвольный префикс
    expect(text).toContain("Уникальный вопрос номер 199");
    expect(text).not.toContain("Уникальный вопрос номер 0 ");
  });
});
