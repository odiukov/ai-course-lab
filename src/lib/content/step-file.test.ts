import { describe, expect, it } from "vitest";
import { parseStep, serializeStep, type Step } from "./step-file";

const SAMPLE = `---
id: "003-broadcasting"
type: theory
title: Броадкастинг
source_anchor: "## Broadcasting"
---

Тело шага.
`;

describe("parseStep", () => {
  it("читает frontmatter и тело", () => {
    const step = parseStep(SAMPLE);
    expect(step.id).toBe("003-broadcasting");
    expect(step.type).toBe("theory");
    expect(step.title).toBe("Броадкастинг");
    expect(step.body.trim()).toBe("Тело шага.");
  });

  it("падает на неизвестном типе", () => {
    expect(() => parseStep(SAMPLE.replace("type: theory", "type: video")))
      .toThrow(/type/);
  });

  it("падает без id", () => {
    expect(() => parseStep(SAMPLE.replace('id: "003-broadcasting"\n', "")))
      .toThrow(/id/);
  });

  it("читает вопросы шага check", () => {
    const md = `---
id: "004-check"
type: check
title: Проверка
check:
  - question: Что должно совпасть?
    options: ["внешние", "внутренние"]
    correct: 1
    explanation: Столбцы A равны строкам B.
---
`;
    const step = parseStep(md);
    expect(step.check?.[0].correct).toBe(1);
  });
});

describe("serializeStep", () => {
  it("делает полный круг без потерь", () => {
    const step: Step = {
      id: "005-matmul",
      type: "code",
      title: "Пишем matmul",
      exercise_fn: "matmul",
      body: "Реализуй функцию.",
    };
    const round = parseStep(serializeStep(step));
    expect(round).toEqual(step);
  });

  it("не пишет пустые поля", () => {
    const out = serializeStep({ id: "001-a", type: "theory", title: "А", body: "Б" });
    expect(out).not.toContain("visual");
    expect(out).not.toContain("exercise_fn");
    // Must contain required fields with correct values
    expect(out).toContain("id: 001-a");
    expect(out).toContain("type: theory");
    expect(out).toContain("title: А");
  });
});
