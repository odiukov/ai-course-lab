import fs from "node:fs";
import path from "node:path";
import { readCatalog, type PhaseRef } from "./catalog";

export interface WrittenFunction {
  fn: string;
  exerciseSlug: string;
  lessonSlug: string | null;
  signature: string;
}

interface FunctionBlock {
  fn: string;
  params: string;
  body: string[];
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

function parseTopLevelFunctions(source: string): FunctionBlock[] {
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
      current = { fn: match[1], params, body: [] };
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

function isImplemented(body: string[]): boolean {
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
  const match = /^p(\d{2})-l(\d{2})-/.exec(exerciseSlug);
  if (!match) return null;
  const phaseNumber = Number(match[1]);
  const lessonNumber = Number(match[2]);
  for (const phase of catalog) {
    if (phase.number !== phaseNumber) continue;
    const lesson = phase.lessons.find((item) => item.lessonNumber === lessonNumber);
    if (lesson) return lesson.slug;
  }
  return null;
}

export function readWrittenFunctions(sourceDir: string): WrittenFunction[] {
  const root = path.join(sourceDir, "learning-exercises");
  if (!fs.existsSync(root)) return [];

  const catalog = readCatalog(sourceDir);
  const written: WrittenFunction[] = [];
  for (const exerciseSlug of fs.readdirSync(root).sort()) {
    const file = path.join(root, exerciseSlug, "exercise.py");
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const block of parseTopLevelFunctions(source)) {
      if (!isImplemented(block.body)) continue;
      written.push({
        fn: block.fn,
        exerciseSlug,
        lessonSlug: lessonSlugFor(catalog, exerciseSlug),
        signature: `${block.fn}(${block.params})`,
      });
    }
  }
  return written;
}
