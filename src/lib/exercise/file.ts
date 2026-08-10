import fs from "node:fs";
import path from "node:path";
import { repoRelative } from "../content/paths";
import type { LessonRef } from "../source/catalog";
import { findExerciseDir } from "../source/naming";
import { isFunctionImplemented, parseTopLevelFunctions } from "../source/written-functions";

export interface ExerciseFunction {
  fn: string;
  signature: string;
  startLine: number;
  endLine: number;
  implemented: boolean;
}

export interface ExerciseFile {
  exerciseSlug: string;
  dir: string;
  file: string;
  relPath: string;
  code: string;
  mtimeMs: number;
  functions: ExerciseFunction[];
  createdFromTemplate: boolean;
}

export function findExercise(
  sourceDir: string,
  ref: LessonRef,
): { slug: string; dir: string } | null {
  const root = path.join(sourceDir, "learning-exercises");
  const found = findExerciseDir(root, ref);
  if (!found) return null;
  return { slug: found, dir: path.join(root, found) };
}

export function describeFunctions(code: string): ExerciseFunction[] {
  return parseTopLevelFunctions(code).map((block) => ({
    fn: block.fn,
    signature: `${block.fn}(${block.params})`,
    startLine: block.startLine,
    endLine: block.endLine,
    implemented: isFunctionImplemented(block.body),
  }));
}

// Единственная точка, которая пишет в exercise.py. Проверка вместо доверия
// вызывающему: путь собирается из slug урока, а slug приходит из адреса, и
// каталог упражнения обязан лежать внутри source/learning-exercises.
function exerciseFilePath(sourceDir: string, dir: string): string {
  const root = path.resolve(sourceDir, "learning-exercises");
  const file = path.resolve(dir, "exercise.py");
  if (!file.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Путь упражнения вне source/learning-exercises: ${file}`);
  }
  return file;
}

// Читает код упражнения по его slug'у (каталогу под learning-exercises), а
// не по LessonRef — recall ищет прошлую реализацию по всему курсу и знает
// только exerciseSlug из readWrittenFunctions. В отличие от readExerciseFile,
// шаблон здесь не разворачивается: урок, у которого exercise.py ещё не
// создан, для recall — просто «ничего не найдено», а не повод его завести.
export function readExerciseCodeBySlug(sourceDir: string, exerciseSlug: string): string | null {
  const dir = path.join(sourceDir, "learning-exercises", exerciseSlug);
  const file = exerciseFilePath(sourceDir, dir);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

export function readExerciseFile(sourceDir: string, ref: LessonRef): ExerciseFile | null {
  const found = findExercise(sourceDir, ref);
  if (!found) return null;

  const file = exerciseFilePath(sourceDir, found.dir);
  let createdFromTemplate = false;
  if (!fs.existsSync(file)) {
    const template = path.join(found.dir, "exercise.template.py");
    if (!fs.existsSync(template)) return null;
    fs.copyFileSync(template, file);
    createdFromTemplate = true;
  }

  const code = fs.readFileSync(file, "utf8");
  return {
    exerciseSlug: found.slug,
    dir: found.dir,
    file,
    relPath: repoRelative(file),
    code,
    mtimeMs: Math.round(fs.statSync(file).mtimeMs),
    functions: describeFunctions(code),
    createdFromTemplate,
  };
}

export function exerciseMtimeMs(sourceDir: string, ref: LessonRef): number | null {
  const found = findExercise(sourceDir, ref);
  if (!found) return null;
  const file = path.join(found.dir, "exercise.py");
  return fs.existsSync(file) ? Math.round(fs.statSync(file).mtimeMs) : null;
}

export function writeExerciseCode(
  sourceDir: string,
  ref: LessonRef,
  code: string,
): { mtimeMs: number; functions: ExerciseFunction[] } {
  const found = findExercise(sourceDir, ref);
  if (!found) throw new Error(`У урока ${ref.slug} нет упражнения`);
  if (code.trim().length === 0) {
    // Пустое тело запроса и потерянное соединение выглядят для сервера
    // одинаково, а результат был бы разный: стёртый файл с решением.
    throw new Error("Код упражнения пуст — запись отклонена");
  }

  const file = exerciseFilePath(sourceDir, found.dir);
  fs.writeFileSync(file, code, "utf8");
  return {
    mtimeMs: Math.round(fs.statSync(file).mtimeMs),
    functions: describeFunctions(code),
  };
}

export function extractFunction(code: string, fn: string): string | null {
  const block = parseTopLevelFunctions(code).find((item) => item.fn === fn);
  if (!block) return null;
  return code
    .split("\n")
    .slice(block.startLine - 1, block.endLine)
    .join("\n");
}

export function replaceFunction(code: string, fn: string, replacement: string): string {
  const block = parseTopLevelFunctions(code).find((item) => item.fn === fn);
  if (!block) return code;
  const lines = code.split("\n");
  return [
    ...lines.slice(0, block.startLine - 1),
    ...replacement.replace(/\s+$/, "").split("\n"),
    ...lines.slice(block.endLine),
  ].join("\n");
}
