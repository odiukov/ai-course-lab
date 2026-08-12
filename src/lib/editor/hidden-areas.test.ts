import { describe, expect, it } from "vitest";
import { functionEndLine, hiddenRanges, type LineSource } from "./hidden-areas";

// Модель Monaco для этих функций — это ровно две операции над текстом, и
// подделать их дешевле, чем поднимать редактор в node-окружении теста.
function modelOf(source: string): LineSource {
  const lines = source.split("\n");
  return {
    getLineCount: () => lines.length,
    getLineContent: (lineNumber: number) => lines[lineNumber - 1] ?? "",
  };
}

const file = modelOf(
  [
    '"""Заголовок файла."""', // 1
    "", // 2
    "", // 3
    "def transpose(M):", // 4
    "    raise NotImplementedError", // 5
    "", // 6
    "", // 7
    "def matmul(A, B):", // 8
    '    """Умножение матриц."""', // 9
    "    rows = []", // 10
    "", // 11
    "    for row in A:", // 12
    "        rows.append(row)", // 13
    "    return rows", // 14
    "", // 15
    "", // 16
    "def identity(n):", // 17
    "    raise NotImplementedError", // 18
  ].join("\n"),
);

describe("functionEndLine", () => {
  it("держит конец на последней строке тела, а не на пустых строках за ним", () => {
    expect(functionEndLine(file, 8)).toBe(14);
  });

  it("не обрывает функцию на пустой строке внутри неё", () => {
    // Строка 11 пустая и лежит посреди matmul: если бы она закрывала функцию,
    // конец приехал бы на 10 и половина кода учащегося уехала бы в скрытое.
    expect(functionEndLine(file, 8)).toBeGreaterThan(11);
  });

  it("закрывает функцию на следующем определении того же уровня", () => {
    expect(functionEndLine(file, 4)).toBe(5);
  });

  it("считает конец по тексту, а не по числам, которые приехали раньше правки", () => {
    // Учащийся дописал две строки в matmul: границы с сервера ещё старые, но
    // конец обязан переехать сразу, иначе новые строки окажутся скрытыми.
    const grown = modelOf(
      ["def matmul(A, B):", "    rows = []", "    rows.append(1)", "    return rows", "", "def identity(n):"].join(
        "\n",
      ),
    );
    expect(functionEndLine(grown, 1)).toBe(4);
  });

  it("доводит последнюю функцию файла до конца текста", () => {
    expect(functionEndLine(file, 17)).toBe(18);
  });

  it("считает вложенный def частью функции", () => {
    const nested = modelOf(
      ["def outer(x):", "    def inner(y):", "        return y", "    return inner", "", "def other():"].join("\n"),
    );
    expect(functionEndLine(nested, 1)).toBe(4);
  });

  it("закрывает функцию комментарием нулевого отступа", () => {
    const commented = modelOf(["def outer(x):", "    return x", "# дальше вспомогательное", "helper = 1"].join("\n"));
    expect(functionEndLine(commented, 1)).toBe(2);
  });
});

describe("hiddenRanges", () => {
  it("прячет всё до функции и всё после неё", () => {
    expect(hiddenRanges(file, 8)).toEqual([
      { startLineNumber: 1, startColumn: 1, endLineNumber: 7, endColumn: 1 },
      { startLineNumber: 15, startColumn: 1, endLineNumber: 18, endColumn: 1 },
    ]);
  });

  it("не выдумывает верхний диапазон для функции с первой строки", () => {
    const first = modelOf(["def matmul(A, B):", "    return []", "", "def identity(n):", "    return []"].join("\n"));
    expect(hiddenRanges(first, 1)).toEqual([
      { startLineNumber: 3, startColumn: 1, endLineNumber: 5, endColumn: 1 },
    ]);
  });

  it("не выдумывает нижний диапазон для функции до конца файла", () => {
    expect(hiddenRanges(file, 17)).toEqual([
      { startLineNumber: 1, startColumn: 1, endLineNumber: 16, endColumn: 1 },
    ]);
  });

  it("ничего не прячет, если строка функции уехала за пределы файла", () => {
    // Границы приезжают с сервера и на секунду отстают от текста. Спрятать по
    // ним половину файла хуже, чем не спрятать ничего.
    expect(hiddenRanges(file, 99)).toEqual([]);
    expect(hiddenRanges(file, 0)).toEqual([]);
  });
});
