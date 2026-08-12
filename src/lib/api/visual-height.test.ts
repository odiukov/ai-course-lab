import { describe, expect, it } from "vitest";
import { HEIGHT_MESSAGE, withHeightReporter } from "./visual-height";

describe("withHeightReporter", () => {
  it("подшивает мерку последней строкой тела", () => {
    const html = "<html><body><div>схема</div></body></html>";

    const result = withHeightReporter(html);

    expect(result).toContain(HEIGHT_MESSAGE);
    expect(result.indexOf("<div>схема</div>")).toBeLessThan(result.indexOf(HEIGHT_MESSAGE));
    expect(result.indexOf(HEIGHT_MESSAGE)).toBeLessThan(result.indexOf("</body>"));
  });

  it("не путается в закрывающем теге, написанном как угодно", () => {
    const result = withHeightReporter("<body><p>схема</p></BODY>");

    expect(result.indexOf(HEIGHT_MESSAGE)).toBeLessThan(result.indexOf("</BODY>"));
  });

  it("выбирает последний </body>, если он встречается в тексте схемы", () => {
    // Схема, которая сама рассказывает про HTML: строка «</body>» в тексте не
    // повод подшить мерку в середину документа.
    const html = "<body><code>&lt;/body&gt;</code><p>a</p></body>";

    const result = withHeightReporter(html);

    expect(result.lastIndexOf("</body>")).toBeGreaterThan(result.indexOf(HEIGHT_MESSAGE));
    expect(result.indexOf("<p>a</p>")).toBeLessThan(result.indexOf(HEIGHT_MESSAGE));
  });

  it("дописывает в конец, если тела в файле нет вовсе", () => {
    const result = withHeightReporter("<div>голая схема</div>");

    expect(result.startsWith("<div>голая схема</div>")).toBe(true);
    expect(result).toContain(HEIGHT_MESSAGE);
  });

  it("оставляет разметку схемы нетронутой", () => {
    const html = "<html><head><style>b{color:red}</style></head><body><b>x</b></body></html>";

    const result = withHeightReporter(html);

    expect(result.replace(/<script>[\s\S]*<\/script>/, "")).toBe(html);
  });
});

describe("мерка считает содержимое, а не окно", () => {
  // scrollHeight никогда не меньше окна, в котором документ показан, а окно
  // здесь — сама рамка: схема подтверждала бы её текущую высоту вместо своей.
  it("не опирается на scrollHeight", () => {
    const script = withHeightReporter("<body></body>");
    expect(script).not.toContain("scrollHeight");
  });

  it("меряет нижний край видимых узлов и нижний отступ тела", () => {
    const script = withHeightReporter("<body></body>");
    expect(script).toContain("getBoundingClientRect");
    expect(script).toContain("marginBottom");
  });

  it("перемеряет после загрузки и на изменение разметки", () => {
    const script = withHeightReporter("<body></body>");
    expect(script).toContain('addEventListener("load"');
    expect(script).toContain("ResizeObserver");
  });
});
