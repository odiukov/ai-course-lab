import fs from "node:fs";
import path from "node:path";
import { readCatalog, type PhaseRef } from "./catalog";
import { parseExerciseSlug } from "./naming";

export interface WrittenFunction {
  fn: string;
  exerciseSlug: string;
  lessonSlug: string | null;
  /** Файл внутри упражнения: `exercise.py` у старой формы, `main.py` и соседи у новой. */
  file: string;
  signature: string;
}

export interface FunctionBlock {
  fn: string;
  params: string;
  body: string[];
  /** 1-based line of the `def` keyword. */
  startLine: number;
  /** 1-based last non-empty line of the block, header included. */
  endLine: number;
}

// Matches the start of a top-level `def`/`async def` header. The parameter
// list is not required to close on this line — a header spanning several
// lines (common with long argument lists) is handled by readHeaderParams.
const HEADER_START = /^(?:async\s+)?def ([a-z][a-z0-9_]*)\(/;

/**
 * Starting at `lines[startIndex]` (a line matched by HEADER_START), consumes
 * lines until the parameter list's parentheses balance, and returns the
 * joined parameter text plus the index of the line containing the closing
 * paren. Handles multi-line signatures by tracking paren depth across lines
 * instead of requiring the closing `)` on the same line as `def`.
 */
function readHeaderParams(lines: string[], startIndex: number): { params: string; endIndex: number } {
  let depth = 0;
  let started = false;
  const collected: string[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    let sliceStart = 0;
    for (let pos = 0; pos < line.length; pos++) {
      const ch = line[pos];
      if (ch === "(") {
        if (!started) {
          started = true;
          sliceStart = pos + 1;
        }
        depth++;
      } else if (ch === ")") {
        depth--;
        if (started && depth === 0) {
          collected.push(line.slice(sliceStart, pos));
          return { params: collected.join(" ").replace(/\s+/g, " ").trim(), endIndex: i };
        }
      }
    }
    if (started) collected.push(line.slice(sliceStart));
  }

  // Unbalanced parens (malformed source): consume the rest of the file
  // rather than looping forever.
  return { params: collected.join(" ").replace(/\s+/g, " ").trim(), endIndex: lines.length - 1 };
}

/**
 * Every top-level `def`/`async def` in a Python file, with its parameter text
 * and body lines. The single header parser for the whole app.
 *
 * Multi-line signatures are why this is a parser and not a regex. Counted over
 * the course as it stands: 63 of 376 `exercise.template.py` files carry 90
 * headers whose parameter list does not close on the `def` line (yolo_loss,
 * best_pool_factor, run_pso among them), and a pattern demanding the closing
 * `)` there reads their parameters as truncated and their remaining header
 * lines as body. `async def` is accepted as well, though no template uses it
 * today.
 */
export function parseTopLevelFunctions(source: string): FunctionBlock[] {
  const lines = source.split("\n");
  const blocks: FunctionBlock[] = [];
  let current: FunctionBlock | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const match = HEADER_START.exec(line);
    if (match) {
      if (current) blocks.push(current);
      const { params, endIndex } = readHeaderParams(lines, i);
      current = {
        fn: match[1],
        params,
        body: [],
        startLine: i + 1,
        endLine: endIndex + 1,
      };
      i = endIndex + 1;
      continue;
    }
    if (!current) {
      i++;
      continue;
    }
    if (line.trim().length > 0 && !/^\s/.test(line)) {
      blocks.push(current);
      current = null;
      continue;
    }
    current.body.push(line);
    // Пустые строки в конец блока не входят: между функциями их две по PEP 8,
    // и включённые в границы они склеили бы сворачивание соседних функций.
    if (line.trim().length > 0) current.endLine = i + 1;
    i++;
  }

  if (current) blocks.push(current);
  return blocks;
}

const DOCSTRING_QUOTES = ['"""', "'''"] as const;

function withoutDocstring(lines: string[]): string[] {
  const [first, ...rest] = lines;
  const quote = DOCSTRING_QUOTES.find((q) => first?.startsWith(q));
  if (!quote) return lines;
  if (first.length > quote.length && first.endsWith(quote)) return rest;
  const end = rest.findIndex((line) => line.includes(quote));
  return end === -1 ? [] : rest.slice(end + 1);
}

export function isFunctionImplemented(body: string[]): boolean {
  const meaningful = body
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const statements = withoutDocstring(meaningful);
  if (statements.length === 0) return false;
  return !statements.every(
    (line) => line === "pass" || line.startsWith("raise NotImplementedError"),
  );
}

function lessonSlugFor(catalog: PhaseRef[], exerciseSlug: string): string | null {
  const parsed = parseExerciseSlug(exerciseSlug);
  if (!parsed) return null;
  const { phaseNumber, lessonNumber } = parsed;
  for (const phase of catalog) {
    if (phase.number !== phaseNumber) continue;
    const lesson = phase.lessons.find((item) => item.lessonNumber === lessonNumber);
    if (lesson) return lesson.slug;
  }
  return null;
}

/**
 * Файлы человека в упражнении: `exercise.py` в корне (старая форма) или всё,
 * что лежит в `exercise/` (каталожная). Читается именно то, что человек
 * написал, а не шаблон: recall обещает «вот как ты это писал».
 */
function learnerFiles(dir: string): { name: string; path: string }[] {
  const flat = path.join(dir, "exercise.py");
  if (fs.existsSync(flat)) return [{ name: "exercise.py", path: flat }];
  const nested = path.join(dir, "exercise");
  if (!fs.existsSync(nested)) return [];
  // Алфавитный порядок, без вынесения main.py первым (как в tree.ts для
  // редактора): этим списком пользуется только поиск по имени функции, а не
  // UI, и алфавита достаточно.
  return fs
    .readdirSync(nested)
    .filter((name) => name.endsWith(".py"))
    .sort()
    .map((name) => ({ name, path: path.join(nested, name) }));
}

export function readWrittenFunctions(sourceDir: string): WrittenFunction[] {
  const root = path.join(sourceDir, "learning-exercises");
  if (!fs.existsSync(root)) return [];

  const catalog = readCatalog(sourceDir);
  const written: WrittenFunction[] = [];
  for (const exerciseSlug of fs.readdirSync(root).sort()) {
    for (const file of learnerFiles(path.join(root, exerciseSlug))) {
      const source = fs.readFileSync(file.path, "utf8");
      for (const block of parseTopLevelFunctions(source)) {
        if (!isFunctionImplemented(block.body)) continue;
        written.push({
          fn: block.fn,
          exerciseSlug,
          lessonSlug: lessonSlugFor(catalog, exerciseSlug),
          file: file.name,
          signature: `${block.fn}(${block.params})`,
        });
      }
    }
  }
  return written;
}
