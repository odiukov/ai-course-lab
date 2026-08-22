import fs from "node:fs";
import path from "node:path";
import { repoRelative } from "../content/paths";
import type { LessonRef } from "../source/catalog";
import { findExerciseDir } from "../source/naming";
import { isFunctionImplemented, parseTopLevelFunctions } from "../source/written-functions";
import { canonicalFunctions, findTreeFile, readExerciseTree, type ExerciseTree } from "./tree";

export interface ExerciseFunction {
  fn: string;
  signature: string;
  startLine: number;
  endLine: number;
  implemented: boolean;
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

export interface ExerciseFileState {
  name: string;
  file: string;
  relPath: string;
  code: string;
  mtimeMs: number;
  functions: ExerciseFunction[];
  createdFromTemplate: boolean;
}

export interface ExerciseFileSet {
  exerciseSlug: string;
  dir: string;
  multi: boolean;
  files: ExerciseFileState[];
}

// Единственная точка, которая собирает путь файла человека — и для чтения, и
// для записи. Две проверки вместо доверия: имя обязано быть в шаблоне (его
// присылает клиент), и собранный путь обязан лежать внутри каталога
// упражнения (`main.py` из чужого упражнения проходит первую проверку, но не
// вторую).
function workFilePath(sourceDir: string, tree: ExerciseTree, name: string): string {
  const ref = findTreeFile(tree, name);
  if (!ref) throw new Error(`В упражнении ${tree.slug} нет файла ${name}`);
  const root = path.resolve(sourceDir, "learning-exercises");
  const file = path.resolve(ref.workPath);
  if (!file.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Путь упражнения вне source/learning-exercises: ${file}`);
  }
  return file;
}

function readOne(sourceDir: string, tree: ExerciseTree, name: string): ExerciseFileState | null {
  const file = workFilePath(sourceDir, tree, name);
  const template = findTreeFile(tree, name)!.templatePath;
  let createdFromTemplate = false;
  if (!fs.existsSync(file)) {
    if (!fs.existsSync(template)) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(template, file);
    createdFromTemplate = true;
  }
  const code = fs.readFileSync(file, "utf8");
  return {
    name,
    file,
    relPath: repoRelative(file),
    code,
    // Без округления: mtimeMs — предусловие записи, и округление до
    // миллисекунды делало бы две записи в один тик неразличимыми.
    mtimeMs: fs.statSync(file).mtimeMs,
    functions: describeFunctions(code),
    createdFromTemplate,
  };
}

export function readExerciseFiles(sourceDir: string, ref: LessonRef): ExerciseFileSet | null {
  const tree = readExerciseTree(sourceDir, ref);
  if (!tree) return null;
  const files: ExerciseFileState[] = [];
  for (const item of tree.files) {
    const state = readOne(sourceDir, tree, item.name);
    if (state) files.push(state);
  }
  if (files.length === 0) return null;
  return { exerciseSlug: tree.slug, dir: tree.dir, multi: tree.multi, files };
}

export function exerciseFileMtimeMs(
  sourceDir: string,
  ref: LessonRef,
  name: string,
): number | null {
  const tree = readExerciseTree(sourceDir, ref);
  if (!tree || !findTreeFile(tree, name)) return null;
  const file = workFilePath(sourceDir, tree, name);
  return fs.existsSync(file) ? fs.statSync(file).mtimeMs : null;
}

export interface ExerciseWrite {
  name: string;
  mtimeMs: number;
  functions: ExerciseFunction[];
}

export interface ExerciseConflict {
  /** Файл на диске изменился с тех пор, как клиент его последний раз видел. */
  conflict: { name: string; code: string; mtimeMs: number; functions: ExerciseFunction[] };
}

// Запись через соседний временный файл и переименование: rename в пределах
// одной файловой системы атомарен, поэтому упавший на середине процесс не
// может оставить обрезанное решение — на диске либо прежний файл целиком,
// либо новый целиком.
function writeAtomically(file: string, code: string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, code, "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

export function writeExerciseFile(
  sourceDir: string,
  ref: LessonRef,
  name: string,
  code: string,
): ExerciseWrite {
  const tree = readExerciseTree(sourceDir, ref);
  if (!tree) throw new Error(`У урока ${ref.slug} нет упражнения`);
  if (code.trim().length === 0) {
    // Пустое тело запроса и потерянное соединение для сервера выглядят
    // одинаково, а результат был бы разный: стёртый файл с решением.
    throw new Error("Код упражнения пуст — запись отклонена");
  }
  const file = workFilePath(sourceDir, tree, name);
  writeAtomically(file, code);
  return { name, mtimeMs: fs.statSync(file).mtimeMs, functions: describeFunctions(code) };
}

/**
 * Пишет код, только если файл на диске всё ещё тот, который клиент видел в
 * последний раз (`expectedMtimeMs` — mtime из предыдущего ответа сервера).
 *
 * Без этой проверки отложенный PUT из редактора затирал и вставку прошлого
 * кода через POST /recall, и правку из IDE, приехавшую в промежутке, — и при
 * этом отвечал «сохранено». Расхождение отдаётся вызывающему вместе с
 * актуальным содержимым файла, чтобы клиент перечитал файл, а не затёр его.
 */
export function writeExerciseFileIfUnchanged(
  sourceDir: string,
  ref: LessonRef,
  name: string,
  code: string,
  expectedMtimeMs: number,
): ExerciseWrite | ExerciseConflict {
  const tree = readExerciseTree(sourceDir, ref);
  if (!tree) throw new Error(`У урока ${ref.slug} нет упражнения`);
  const file = workFilePath(sourceDir, tree, name);
  if (fs.existsSync(file)) {
    const actual = fs.statSync(file).mtimeMs;
    if (actual !== expectedMtimeMs) {
      const current = fs.readFileSync(file, "utf8");
      return {
        conflict: { name, code: current, mtimeMs: actual, functions: describeFunctions(current) },
      };
    }
  }
  return writeExerciseFile(sourceDir, ref, name, code);
}

/**
 * Канонические имена функций всего упражнения — по всем файлам.
 *
 * Отдельно от describeFunctions, и это не украшение. Выражение `pytest -k`
 * собирается как «имя функции шага И НЕ остальные функции упражнения», и если
 * «остальные» брать из ТЕКУЩИХ файлов человека, то любая вспомогательная
 * функция учащегося попадает в отрицание. Учащийся написал себе `def shape(M)`
 * — и фильтр шага identity превращается в `identity and not (… or shape or
 * …)`, который отрезает настоящий `test_identity_shape_and_content`. Остаётся
 * один тест, панель говорит «1 из 1 зелёные», шаг записывается пройденным, а
 * его собственные тесты не гонялись вовсе.
 *
 * В многофайловом упражнении отрицание собирается по функциям ВСЕХ файлов, а
 * не только того, что редактируется на этом шаге: `pytest -k` фильтрует по
 * именам тестов всего прогона, который видит весь набор файлов упражнения
 * целиком, и вспомогательная функция в соседнем файле отрезает тест теми же
 * средствами, что и в своём.
 *
 * Плоский список имён, а не пар: он идёт в отрицание фильтра `pytest -k`, а
 * `-k` про файлы ничего не знает. Пары нужны валидатору плана, он берёт их из
 * canonicalFunctions(tree).
 */
export function readCanonicalFunctionNames(sourceDir: string, ref: LessonRef): string[] {
  const tree = readExerciseTree(sourceDir, ref);
  if (!tree) return [];
  return canonicalFunctions(tree).map((pair) => pair.fn);
}

// Читает код упражнения по его slug'у (каталогу под learning-exercises), а
// не по LessonRef — recall ищет прошлую реализацию по всему курсу и знает
// только exerciseSlug из readWrittenFunctions. В отличие от readExerciseFiles,
// шаблон здесь не разворачивается: урок, у которого файла ещё нет, для recall
// — просто «ничего не найдено», а не повод его завести.
export function readExerciseCodeBySlug(
  sourceDir: string,
  exerciseSlug: string,
  name = "exercise.py",
): string | null {
  const root = path.resolve(sourceDir, "learning-exercises");
  const dir = path.join(root, exerciseSlug);
  // Каталожная форма держит файлы человека в exercise/, старая — в корне
  // каталога упражнения. Обе проверяются, потому что recall ищет по всему
  // курсу, где сейчас лежат обе.
  for (const candidate of [path.join(dir, name), path.join(dir, "exercise", name)]) {
    const file = path.resolve(candidate);
    if (!file.startsWith(`${root}${path.sep}`)) continue;
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  }
  return null;
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
