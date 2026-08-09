import { describe, expect, it } from "vitest";
import { renderPrompt } from "./prompts";

describe("renderPrompt", () => {
  it("подставляет переменные", () => {
    const out = renderPrompt("write-step", {
      lesson_title: "Бета",
      step_title: "Транспонирование",
      step_type: "theory",
      source_excerpt: "текст урока",
      neighbours: "предыдущий шаг",
    });
    expect(out).toContain("Транспонирование");
    expect(out).toContain("текст урока");
    expect(out).not.toContain("{{");
  });

  it("падает, если переменная не передана", () => {
    expect(() => renderPrompt("write-step", { lesson_title: "Бета" })).toThrow(/step_title/);
  });
});
