export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnostic {
  range: LspRange;
  message: string;
  severity?: number;
  source?: string;
  code?: string | number;
}

export interface MonacoRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface MonacoMarker extends MonacoRange {
  message: string;
  severity: number;
  source: string;
}

export interface MonacoTextEdit {
  range: MonacoRange;
  text: string;
}

export interface MonacoCompletion {
  label: string;
  insertText: string;
  kind: number;
  detail: string;
  documentation: string;
  range: MonacoRange;
  /**
   * Правки за пределами вставляемого слова. У pyright это строка `import`, без
   * которой автодополнение по авто-импорту вставляет одно голое имя — и
   * следующий прогон тестов падает по причине, которой учащийся не создавал.
   */
  additionalTextEdits?: MonacoTextEdit[];
  /**
   * Порядок и фильтр, назначенные сервером. Pyright задаёт их специально,
   * чтобы `__dunder__` уезжали в конец списка; без них `np.` предлагает
   * `__class__` раньше `array`.
   */
  sortText?: string;
  filterText?: string;
}

// MarkerSeverity в Monaco: Hint 1, Info 2, Warning 4, Error 8. Числа, а не
// enum, потому что модуль обязан оставаться свободным от импорта monaco: его
// гоняют юнит-тесты в окружении node.
const SEVERITY: Record<number, number> = { 1: 8, 2: 4, 3: 2, 4: 1 };

// LSP CompletionItemKind (1..25) → monaco.languages.CompletionItemKind.
// Таблица явная: наборы не совпадают ни началом, ни порядком, и «функция» LSP
// (3) в Monaco означала бы «конструктор» (2).
const COMPLETION_KIND: Record<number, number> = {
  1: 18, // Text
  2: 0, // Method
  3: 1, // Function
  4: 2, // Constructor
  5: 3, // Field
  6: 4, // Variable
  7: 5, // Class
  8: 7, // Interface
  9: 8, // Module
  10: 9, // Property
  11: 12, // Unit
  12: 13, // Value
  13: 15, // Enum
  14: 17, // Keyword
  // Snippet в установленной версии Monaco — 28, а 27 это Tool. Таблица
  // проверяется тестом против настоящего enum, чтобы не разъехаться снова.
  15: 28, // Snippet
  16: 19, // Color
  17: 20, // File
  18: 21, // Reference
  19: 23, // Folder
  20: 16, // EnumMember
  21: 14, // Constant
  22: 6, // Struct
  23: 10, // Event
  24: 11, // Operator
  25: 24, // TypeParameter
};

export function toMonacoRange(range: LspRange): MonacoRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

export function toMarker(diagnostic: LspDiagnostic): MonacoMarker {
  return {
    ...toMonacoRange(diagnostic.range),
    // Без severity — ошибка: pyright присылает предупреждения и подсказки с
    // явным уровнем, а молча пропущенное поле почти всегда значит ошибку.
    severity: SEVERITY[diagnostic.severity ?? 1] ?? 8,
    message: diagnostic.code ? `${diagnostic.message} (${diagnostic.code})` : diagnostic.message,
    source: diagnostic.source ?? "pyright",
  };
}

export function toCompletionKind(lspKind: number | undefined): number {
  if (lspKind === undefined) return 18;
  return COMPLETION_KIND[lspKind] ?? 18;
}

interface RawCompletion {
  label?: unknown;
  kind?: unknown;
  insertText?: unknown;
  detail?: unknown;
  documentation?: unknown;
  textEdit?: { range?: LspRange; newText?: string };
  additionalTextEdits?: { range?: LspRange; newText?: unknown }[];
  sortText?: unknown;
  filterText?: unknown;
}

// Правки вне вставляемого слова. Пропускаем только те, у которых есть и
// диапазон, и текст: правка без диапазона — это не «вставить в начало файла»,
// это испорченный ответ, и применять её нельзя.
function toAdditionalEdits(raw: RawCompletion["additionalTextEdits"]): MonacoTextEdit[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const edits = raw
    .filter((edit) => edit?.range !== undefined && typeof edit.newText === "string")
    .map((edit) => ({ range: toMonacoRange(edit.range as LspRange), text: String(edit.newText) }));
  return edits.length > 0 ? edits : undefined;
}

function documentationText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "value" in value) {
    return String((value as { value: unknown }).value ?? "");
  }
  return "";
}

export function toCompletionItems(result: unknown, fallbackRange: MonacoRange): MonacoCompletion[] {
  const items: RawCompletion[] = Array.isArray(result)
    ? (result as RawCompletion[])
    : result && typeof result === "object" && Array.isArray((result as { items?: unknown }).items)
      ? ((result as { items: RawCompletion[] }).items)
      : [];

  return items
    .filter((item) => typeof item.label === "string")
    .map((item) => ({
      label: String(item.label),
      insertText:
        typeof item.textEdit?.newText === "string"
          ? item.textEdit.newText
          : typeof item.insertText === "string"
            ? item.insertText
            : String(item.label),
      kind: toCompletionKind(typeof item.kind === "number" ? item.kind : undefined),
      detail: typeof item.detail === "string" ? item.detail : "",
      documentation: documentationText(item.documentation),
      range: item.textEdit?.range ? toMonacoRange(item.textEdit.range) : fallbackRange,
      additionalTextEdits: toAdditionalEdits(item.additionalTextEdits),
      sortText: typeof item.sortText === "string" ? item.sortText : undefined,
      filterText: typeof item.filterText === "string" ? item.filterText : undefined,
    }));
}

export function hoverMarkdown(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const contents = (result as { contents?: unknown }).contents;
  if (!contents) return "";
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((part) => (typeof part === "string" ? part : documentationText(part)))
      .filter((part) => part.length > 0)
      .join("\n\n");
  }
  return documentationText(contents);
}

export interface MonacoSignatureHelp {
  signatures: { label: string; documentation: string; parameters: { label: string; documentation: string }[] }[];
  activeSignature: number;
  activeParameter: number;
}

export function toSignatureHelp(result: unknown): MonacoSignatureHelp | null {
  if (!result || typeof result !== "object") return null;
  const raw = result as {
    signatures?: { label?: unknown; documentation?: unknown; parameters?: { label?: unknown; documentation?: unknown }[] }[];
    activeSignature?: unknown;
    activeParameter?: unknown;
  };
  if (!Array.isArray(raw.signatures) || raw.signatures.length === 0) return null;

  return {
    signatures: raw.signatures.map((signature) => ({
      label: String(signature.label ?? ""),
      documentation: documentationText(signature.documentation),
      parameters: (signature.parameters ?? []).map((parameter) => ({
        label: String(parameter.label ?? ""),
        documentation: documentationText(parameter.documentation),
      })),
    })),
    activeSignature: typeof raw.activeSignature === "number" ? raw.activeSignature : 0,
    activeParameter: typeof raw.activeParameter === "number" ? raw.activeParameter : 0,
  };
}
