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

/**
 * Канонический список функций упражнения — имена из `exercise.template.py`
 * (а если шаблона нет, из `solution.py`).
 *
 * Отдельно от describeFunctions, и это не украшение. Выражение `pytest -k`
 * собирается как «имя функции шага И НЕ остальные функции упражнения», и если
 * «остальные» брать из ТЕКУЩЕГО exercise.py, то любая вспомогательная функция
 * учащегося попадает в отрицание. Учащийся написал себе `def shape(M)` — и
 * фильтр шага identity превращается в `identity and not (… or shape or …)`,
 * который отрезает настоящий `test_identity_shape_and_content`. Остаётся один
 * тест, панель говорит «1 из 1 зелёные», шаг записывается пройденным, а его
 * собственные тесты не гонялись вовсе.
 *
 * Шаблон и решение учащийся не редактирует, поэтому их список функций — это
 * то, что упражнение действительно требует написать.
 */
export function readCanonicalFunctions(sourceDir: string, ref: LessonRef): string[] {
  const found = findExercise(sourceDir, ref);
  if (!found) return [];
  for (const name of ["exercise.template.py", "solution.py"]) {
    const file = path.join(found.dir, name);
    if (!fs.existsSync(file)) continue;
    const names = parseTopLevelFunctions(fs.readFileSync(file, "utf8")).map((block) => block.fn);
    if (names.length > 0) return names;
  }
  // Ни шаблона, ни решения: врать про канонический состав нельзя, а взять его
  // из файла учащегося — это ровно та ошибка, от которой здесь защита. Пустой
  // список означает фильтр из одного имени: он может собрать лишние тесты
  // (шаг покраснеет), но не может отрезать свои собственные.
  return [];
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

// Единственная точка, которая собирает путь к exercise.py — и для чтения, и
// для записи. Проверка вместо доверия вызывающему: путь строится из slug
// урока, slug приходит из адреса, и каталог упражнения обязан лежать внутри
// source/learning-exercises.
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
    // Без округления: mtimeMs — это предусловие записи, и на файловой системе
    // с наносекундными метками две записи в одну и ту же округлённую
    // миллисекунду дали бы равные значения, а отложенный PUT прошёл бы
    // проверку и затёр чужую правку.
    mtimeMs: fs.statSync(file).mtimeMs,
    functions: describeFunctions(code),
    createdFromTemplate,
  };
}

export function exerciseMtimeMs(sourceDir: string, ref: LessonRef): number | null {
  const found = findExercise(sourceDir, ref);
  if (!found) return null;
  const file = exerciseFilePath(sourceDir, found.dir);
  return fs.existsSync(file) ? fs.statSync(file).mtimeMs : null;
}

export interface ExerciseWrite {
  mtimeMs: number;
  functions: ExerciseFunction[];
}

export interface ExerciseConflict {
  /** Файл на диске изменился с тех пор, как клиент его последний раз видел. */
  conflict: { code: string; mtimeMs: number; functions: ExerciseFunction[] };
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

export function writeExerciseCode(
  sourceDir: string,
  ref: LessonRef,
  code: string,
): ExerciseWrite {
  const found = findExercise(sourceDir, ref);
  if (!found) throw new Error(`У урока ${ref.slug} нет упражнения`);
  if (code.trim().length === 0) {
    // Пустое тело запроса и потерянное соединение выглядят для сервера
    // одинаково, а результат был бы разный: стёртый файл с решением.
    throw new Error("Код упражнения пуст — запись отклонена");
  }

  const file = exerciseFilePath(sourceDir, found.dir);
  writeAtomically(file, code);
  return {
    mtimeMs: fs.statSync(file).mtimeMs,
    functions: describeFunctions(code),
  };
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
export function writeExerciseCodeIfUnchanged(
  sourceDir: string,
  ref: LessonRef,
  code: string,
  expectedMtimeMs: number,
): ExerciseWrite | ExerciseConflict {
  const found = findExercise(sourceDir, ref);
  if (!found) throw new Error(`У урока ${ref.slug} нет упражнения`);

  const file = exerciseFilePath(sourceDir, found.dir);
  // Файла нет — затирать нечего, и отказ был бы вредным: так выглядит первое
  // сохранение упражнения, чей exercise.py кто-то успел удалить.
  if (fs.existsSync(file)) {
    const actual = fs.statSync(file).mtimeMs;
    if (actual !== expectedMtimeMs) {
      const current = fs.readFileSync(file, "utf8");
      return {
        conflict: { code: current, mtimeMs: actual, functions: describeFunctions(current) },
      };
    }
  }

  return writeExerciseCode(sourceDir, ref, code);
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
