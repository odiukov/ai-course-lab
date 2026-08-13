import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StepBody } from "./StepBody";

describe("StepBody", () => {
  it("renders lesson-step references as real reader URLs", () => {
    const html = renderToStaticMarkup(
      createElement(StepBody, {
        body: "Смотри шаг 31.",
        currentStepNumber: 33,
        onStepLink: () => undefined,
      }),
    );

    expect(html).toContain('<a href="?step=30">31</a>');
  });

  it("uses the supplied href builder for step references", () => {
    const html = renderToStaticMarkup(
      createElement(StepBody, {
        body: "Смотри шаг 31.",
        currentStepNumber: 33,
        hrefForStep: (stepNumber: number) => `#step-0${stepNumber}-integral`,
      }),
    );

    expect(html).toContain('<a href="#step-031-integral">31</a>');
  });

  it("renders a standalone single-line formula as display math", () => {
    const html = renderToStaticMarkup(
      createElement(StepBody, { body: String.raw`$$d(a,b)=\lVert a-b\rVert$$` }),
    );

    expect(html).toContain('class="katex-display"');
  });

  it("renders LaTeX parenthesis delimiters as inline math", () => {
    const html = renderToStaticMarkup(
      createElement(StepBody, { body: String.raw`Координаты \(x_1,\ldots,x_n\).` }),
    );

    expect(html).toContain('class="katex"');
    expect(html).not.toContain("Координаты (x_1");
  });
});
