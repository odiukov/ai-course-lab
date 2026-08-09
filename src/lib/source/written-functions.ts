import fs from "node:fs";
import path from "node:path";
import { readCatalog } from "./catalog";

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

const DEF_LINE = /^def ([a-z][a-z0-9_]*)\(([^)]*)\)/;

function parseTopLevelFunctions(source: string): FunctionBlock[] {
  const blocks: FunctionBlock[] = [];
  let current: FunctionBlock | null = null;

  for (const line of source.split("\n")) {
    const match = DEF_LINE.exec(line);
    if (match) {
      if (current) blocks.push(current);
      current = { fn: match[1], params: match[2], body: [] };
      continue;
    }
    if (!current) continue;
    if (line.trim().length > 0 && !/^\s/.test(line)) {
      blocks.push(current);
      current = null;
      continue;
    }
    current.body.push(line);
  }

  if (current) blocks.push(current);
  return blocks;
}

function withoutDocstring(lines: string[]): string[] {
  const [first, ...rest] = lines;
  if (!first?.startsWith('"""')) return lines;
  if (first.length > 3 && first.endsWith('"""')) return rest;
  const end = rest.findIndex((line) => line.includes('"""'));
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

function lessonSlugFor(sourceDir: string, exerciseSlug: string): string | null {
  const match = /^p(\d{2})-l(\d{2})-/.exec(exerciseSlug);
  if (!match) return null;
  const phaseNumber = Number(match[1]);
  const lessonNumber = Number(match[2]);
  for (const phase of readCatalog(sourceDir)) {
    if (phase.number !== phaseNumber) continue;
    const lesson = phase.lessons.find((item) => item.lessonNumber === lessonNumber);
    if (lesson) return lesson.slug;
  }
  return null;
}

export function readWrittenFunctions(sourceDir: string): WrittenFunction[] {
  const root = path.join(sourceDir, "learning-exercises");
  if (!fs.existsSync(root)) return [];

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
        lessonSlug: lessonSlugFor(sourceDir, exerciseSlug),
        signature: `${block.fn}(${block.params})`,
      });
    }
  }
  return written;
}
