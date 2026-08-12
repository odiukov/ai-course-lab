/**
 * Что из файла упражнения редактор показывает учащемуся: только функцию его
 * шага, остальное спрятано.
 *
 * Логика живёт отдельно от компонента, потому что она чисто текстовая:
 * Monaco нужен ей ровно двумя методами модели, а тесту — ни одного браузера.
 */

/** Модель Monaco в том объёме, в каком её здесь спрашивают. */
export interface LineSource {
  getLineCount(): number;
  getLineContent(lineNumber: number): string;
}

export interface LineRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

// Отступ в пробелах. Табы считаются по tabSize редактора (4), иначе строка с
// табом выглядела бы менее вложенной, чем она есть.
function indentWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
}

/**
 * Последняя строка функции, начинающейся на `startLine` — по самому тексту.
 *
 * Границы функций приезжают с сервера после автосохранения, то есть отстают от
 * набора на секунду. Если бы прятали по ним, каждая новая строка учащегося
 * пропадала бы из виду до следующего сохранения. Отступ же виден сразу: тело
 * функции — это всё, что вложено глубже строки `def`, а пустые строки внутри
 * ничего не закрывают.
 */
export function functionEndLine(model: LineSource, startLine: number): number {
  const total = model.getLineCount();
  const baseIndent = indentWidth(model.getLineContent(startLine));

  let end = startLine;
  for (let line = startLine + 1; line <= total; line += 1) {
    const text = model.getLineContent(line);
    if (text.trim() === "") continue;
    if (indentWidth(text) <= baseIndent) break;
    end = line;
  }
  return end;
}

/**
 * Диапазоны, которые редактор прячет: всё до функции шага и всё после неё.
 *
 * Прячется только показ — модель остаётся целой, поэтому pyright видит импорты
 * и соседние функции, а сохранение пишет весь файл, а не кусок.
 */
export function hiddenRanges(model: LineSource, startLine: number): LineRange[] {
  const total = model.getLineCount();
  // Строка функции пришла с сервера и на секунду отстаёт от текста. Спрятать по
  // такой половину файла хуже, чем не прятать ничего.
  if (startLine < 1 || startLine > total) return [];

  const ranges: LineRange[] = [];
  if (startLine > 1) {
    ranges.push({ startLineNumber: 1, startColumn: 1, endLineNumber: startLine - 1, endColumn: 1 });
  }

  const end = functionEndLine(model, startLine);
  if (end < total) {
    ranges.push({ startLineNumber: end + 1, startColumn: 1, endLineNumber: total, endColumn: 1 });
  }
  return ranges;
}
