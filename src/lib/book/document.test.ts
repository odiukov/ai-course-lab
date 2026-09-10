import { describe, expect, it } from "vitest";
import type { BookModel } from "./build";
import {
  renderStaticBookDownloadHtml,
  renderStaticBookHtml,
  renderStaticBookPhaseHtml,
} from "./document";

const book: BookModel = {
  phaseNumber: 2,
  phaseTitle: "Transformers",
  generatedAt: new Date("2026-09-10T00:00:00Z"),
  lessons: [
    {
      slug: "02-transformers__01-attention",
      number: 1,
      title: "Attention",
      sections: [
        {
          id: "001-theory",
          number: 1,
          title: "Theory",
          body: "The **current** material.",
          clarifications: [],
          visualHtml: null,
          visualHref: "/base/visuals/attention.html",
        },
      ],
      solutions: [],
    },
  ],
};

describe("static book", () => {
  it("renders a lightweight Pages shell with deployed assets", () => {
    const html = renderStaticBookHtml({
      basePath: "/ai-course-lab",
      title: "Complete & current",
      fragments: ["/ai-course-lab/book/phase-02/content.html.gz"],
    });

    expect(html).toContain("Complete &amp; current");
    expect(html).toContain('href="/ai-course-lab/assets/katex/katex.min.css"');
    expect(html).toContain('src="/ai-course-lab/assets/book.js"');
    expect(html).toContain("/ai-course-lab/book/phase-02/content.html.gz");
    expect(html).not.toContain("The <strong>current</strong> material.");
  });

  it("renders phase content once with external visual placeholders", () => {
    const html = renderStaticBookPhaseHtml(book);

    expect(html).toContain("The <strong>current</strong> material.");
    expect(html).toContain('data-visual-src="/base/visuals/attention.html"');
    expect(html).not.toContain("<iframe");
  });

  it("redirects the legacy complete-book page to a prepared PDF", () => {
    const html = renderStaticBookDownloadHtml({
      basePath: "/base",
      downloadUrl: "https://example.com/book.pdf",
    });

    expect(html).toContain('href="https://example.com/book.pdf"');
    expect(html).toContain('window.location.replace("https://example.com/book.pdf")');
  });
});
