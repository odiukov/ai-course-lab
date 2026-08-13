import { describe, expect, it } from "vitest";
import { anchorHrefForStep, stepAnchor } from "./anchors";

describe("stepAnchor", () => {
  it("builds an anchor from the step id", () => {
    expect(stepAnchor("003-kasatelnaya")).toBe("step-003-kasatelnaya");
  });
});

describe("anchorHrefForStep", () => {
  const href = anchorHrefForStep(["001-problem", "002-proizvodnaya", "003-kasatelnaya"]);

  it("maps a human step number onto that step's anchor", () => {
    expect(href(3)).toBe("#step-003-kasatelnaya");
  });

  it("leaves a number outside the plan alone", () => {
    // Ссылка ведёт в никуда и в приложении — текст вокруг неё от этого
    // не должен ломаться.
    expect(href(99)).toBe("#step-99");
  });

  it("does not treat zero as the last step", () => {
    expect(href(0)).toBe("#step-0");
  });
});
