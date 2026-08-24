import { describe, expect, it } from "vitest";
import { linkStepReferences, stepNumberFromHref } from "./step-links";

describe("step links", () => {
  it("links singular references to earlier lesson steps", () => {
    expect(linkStepReferences("Формула из шага 4 и пример на шаге 7.", 10)).toBe(
      "Формула из шага [4](#step-4) и пример на шаге [7](#step-7).",
    );
  });

  it("links both ends of ranges and every number in short lists", () => {
    expect(linkStepReferences("шаги 25–30; из шагов 9, 15 и 19; шаги 49 и 51", 60)).toBe(
      "шаги [25](#step-25)–[30](#step-30); из шагов [9](#step-9), [15](#step-15) и [19](#step-19); шаги [49](#step-49) и [51](#step-51)",
    );
  });

  it("does not invent links for code, fenced blocks, action numbering or non-lesson steps", () => {
    const body = [
      "`из шага 4` и **Шаг 1.** Сделай это.",
      "Шаг 1b алгоритма и шаг 0 в strides, на шаге 9001 появился nan, перешагнув 4 порога.",
      "```text",
      "из шага 4",
      "```",
    ].join("\n");
    expect(linkStepReferences(body, 20)).toBe(body);
  });

  it("does not link the current or a future step and does not nest existing links", () => {
    expect(linkStepReferences("шаг 8, шаг 9 и [шаг 3](#step-3)", 8)).toBe(
      "шаг 8, шаг 9 и [шаг 3](#step-3)",
    );
  });

  it("expands an ambiguous existing link into one link per referenced step", () => {
    expect(linkStepReferences("из [шагов 4, 5 и 12](#step-4)", 15)).toBe(
      "из шагов [4](#step-4), [5](#step-5) и [12](#step-12)",
    );
    expect(linkStepReferences("после [шагов 42–44](#step-42)", 50)).toBe(
      "после шагов [42](#step-42)–[44](#step-44)",
    );
  });

  it("reads only canonical positive step anchors", () => {
    expect(stepNumberFromHref("#step-31")).toBe(31);
    expect(stepNumberFromHref("#step-0")).toBeNull();
    expect(stepNumberFromHref("?step=31")).toBeNull();
  });
});
