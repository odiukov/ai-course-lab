import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StepBody } from "./StepBody";

describe("StepBody", () => {
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
