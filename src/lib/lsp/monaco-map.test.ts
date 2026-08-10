import { describe, expect, it } from "vitest";
import { hoverMarkdown, toCompletionItems, toCompletionKind, toMarker, toSignatureHelp } from "./monaco-map";

const range = { startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 9 };

describe("toMarker", () => {
  it("сдвигает нумерацию с нулевой на единичную", () => {
    const marker = toMarker({
      range: { start: { line: 4, character: 11 }, end: { line: 4, character: 20 } },
      message: '"unknown_name" is not defined',
      severity: 1,
    });
    expect(marker).toMatchObject({
      startLineNumber: 5,
      startColumn: 12,
      endLineNumber: 5,
      endColumn: 21,
      severity: 8,
      source: "pyright",
    });
  });

  it("предупреждение и подсказка получают свои уровни Monaco", () => {
    expect(toMarker({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "m", severity: 2 }).severity).toBe(4);
    expect(toMarker({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "m", severity: 4 }).severity).toBe(1);
  });

  it("без severity считает ошибкой — pyright молчать зря не станет", () => {
    expect(toMarker({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "m" }).severity).toBe(8);
  });

  it("код правила приписывается к сообщению, если он есть", () => {
    const marker = toMarker({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: "не то",
      code: "reportUndefinedVariable",
    });
    expect(marker.message).toBe("не то (reportUndefinedVariable)");
  });
});

describe("toCompletionKind", () => {
  it("функция LSP превращается в функцию Monaco, а не в конструктор", () => {
    expect(toCompletionKind(3)).toBe(1);
  });

  it("переменная, класс и модуль тоже на своих местах", () => {
    expect(toCompletionKind(6)).toBe(4);
    expect(toCompletionKind(7)).toBe(5);
    expect(toCompletionKind(9)).toBe(8);
  });

  it("неизвестный код становится текстом, а не падает", () => {
    expect(toCompletionKind(999)).toBe(18);
    expect(toCompletionKind(undefined)).toBe(18);
  });
});

describe("toCompletionItems", () => {
  it("читает и CompletionList, и голый массив", () => {
    const list = toCompletionItems({ items: [{ label: "transpose", kind: 3 }] }, range);
    const array = toCompletionItems([{ label: "transpose", kind: 3 }], range);
    expect(list).toEqual(array);
    expect(list[0]).toMatchObject({ label: "transpose", insertText: "transpose", kind: 1, range });
  });

  it("insertText из сервера уважается, textEdit даёт свой диапазон", () => {
    const [item] = toCompletionItems(
      {
        items: [
          {
            label: "matmul(A, B)",
            kind: 3,
            insertText: "matmul",
            detail: "def matmul(A, B) -> list",
            textEdit: {
              range: { start: { line: 1, character: 4 }, end: { line: 1, character: 8 } },
              newText: "matmul",
            },
          },
        ],
      },
      range,
    );
    expect(item.insertText).toBe("matmul");
    expect(item.detail).toBe("def matmul(A, B) -> list");
    expect(item.range).toEqual({ startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 9 });
  });

  it("мусор вместо ответа даёт пустой список", () => {
    expect(toCompletionItems(null, range)).toEqual([]);
  });
});

describe("hoverMarkdown", () => {
  it("MarkupContent отдаётся как есть", () => {
    expect(hoverMarkdown({ contents: { kind: "markdown", value: "```python\ndef transpose(M)\n```" } })).toContain(
      "def transpose(M)",
    );
  });

  it("массив строк склеивается", () => {
    expect(hoverMarkdown({ contents: ["первое", { value: "второе" }] })).toBe("первое\n\nвторое");
  });

  it("пустой hover — пустая строка, а не «undefined»", () => {
    expect(hoverMarkdown(null)).toBe("");
  });
});

describe("toSignatureHelp", () => {
  it("переносит подписи и активный параметр", () => {
    const help = toSignatureHelp({
      signatures: [{ label: "matmul(A, B)", parameters: [{ label: "A" }, { label: "B" }] }],
      activeSignature: 0,
      activeParameter: 1,
    })!;
    expect(help.signatures[0].label).toBe("matmul(A, B)");
    expect(help.activeParameter).toBe(1);
  });

  it("без подписей отдаёт null", () => {
    expect(toSignatureHelp({ signatures: [] })).toBeNull();
  });
});
