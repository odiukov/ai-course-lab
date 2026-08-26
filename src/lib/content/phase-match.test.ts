import { describe, expect, it } from "vitest";
import { lessonPhaseNumber, matchesPhase } from "./phase-match";

describe("lessonPhaseNumber", () => {
  it("читает номер фазы из начала слага", () => {
    expect(lessonPhaseNumber("01-math-foundations__02-vectors")).toBe(1);
  });

  it("читает двузначный номер фазы", () => {
    expect(lessonPhaseNumber("12-something__03-lesson")).toBe(12);
  });

  it("возвращает null для слага без номера фазы в начале", () => {
    expect(lessonPhaseNumber("math-foundations")).toBeNull();
  });
});

describe("matchesPhase", () => {
  it("«01» находит слаг фазы 01", () => {
    expect(matchesPhase("01-math-foundations__02-vectors", "01")).toBe(true);
  });

  it("«1» находит тот же слаг, что и «01» — тот же баг, что уронил ворота", () => {
    expect(matchesPhase("01-math-foundations__02-vectors", "1")).toBe(true);
  });

  it("не находит слаг соседней фазы", () => {
    expect(matchesPhase("02-llm-foundations__01-tokenizers", "1")).toBe(false);
  });

  it("«09» и «9» находят одну и ту же фазу", () => {
    const slug = "09-agents__01-intro";
    expect(matchesPhase(slug, "09")).toBe(true);
    expect(matchesPhase(slug, "9")).toBe(true);
  });

  it("нечисловой аргумент не совпадает ни с чем", () => {
    expect(matchesPhase("01-math-foundations__02-vectors", "abc")).toBe(false);
  });

  it("фаза, которой нет ни у одного урока, просто не совпадает — вызывающий код решает, что с этим делать", () => {
    expect(matchesPhase("01-math-foundations__02-vectors", "99")).toBe(false);
  });
});
