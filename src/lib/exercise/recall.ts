import type { LessonRef } from "../source/catalog";
import { readWrittenFunctions } from "../source/written-functions";
import {
  extractFunction,
  readExerciseCodeBySlug,
  readExerciseFiles,
  replaceFunction,
  writeExerciseFile,
  type ExerciseFunction,
} from "./file";

export interface PreviousImplementation {
  fn: string;
  exerciseSlug: string;
  lessonSlug: string | null;
  /** Файл, из которого взят код: нужен, чтобы карточка называла источник целиком. */
  file: string;
  code: string;
}

export function findPreviousImplementation(
  sourceDir: string,
  fn: string,
  excludeExerciseSlug: string,
): PreviousImplementation | null {
  // readWrittenFunctions идёт по каталогам в отсортированном порядке, а слаги
  // начинаются с pNN-lNN-, поэтому последнее совпадение — самое свежее.
  const candidates = readWrittenFunctions(sourceDir).filter(
    (item) => item.fn === fn && item.exerciseSlug !== excludeExerciseSlug,
  );
  const latest = candidates.at(-1);
  if (!latest) return null;

  const source = readExerciseCodeBySlug(sourceDir, latest.exerciseSlug, latest.file);
  if (!source) return null;
  const code = extractFunction(source, fn);
  if (!code) return null;

  return {
    fn,
    exerciseSlug: latest.exerciseSlug,
    lessonSlug: latest.lessonSlug,
    file: latest.file,
    code,
  };
}

/**
 * Вставляет прошлую реализацию на место заготовки в упражнении текущего урока
 * и пишет результат на диск.
 *
 * `{ error }` — только там, где вставлять действительно некуда: у урока нет
 * упражнения или в его exercise.py нет функции `fn`. «Замена не изменила
 * текст» ошибкой НЕ считается: так выглядит повторный заход на тот же
 * recall-шаг, где прошлый код уже стоит на месте. Раньше эти два случая были
 * склеены сравнением строк, и вторая кнопка «Взять как есть» отвечала «в
 * упражнении этого урока нет функции X» под карточкой, показывающей эту самую
 * функцию.
 */
export function insertPreviousImplementation(
  sourceDir: string,
  ref: LessonRef,
  fn: string,
  previous: PreviousImplementation,
  fileName = "exercise.py",
): { code: string; functions: ExerciseFunction[]; changed: boolean } | { error: string } {
  const set = readExerciseFiles(sourceDir, ref);
  const state = set?.files.find((item) => item.name === fileName);
  if (!state) return { error: "У урока нет упражнения" };
  if (!state.functions.some((item) => item.fn === fn)) {
    return { error: `В упражнении этого урока нет функции ${fn} — вставить некуда` };
  }

  const code = replaceFunction(state.code, fn, previous.code);
  // «Замена не изменила текст» — не ошибка: так выглядит повторный заход на
  // тот же recall-шаг, где прошлый код уже стоит на месте.
  if (code === state.code) return { code, functions: state.functions, changed: false };

  const written = writeExerciseFile(sourceDir, ref, fileName, code);
  return { code, functions: written.functions, changed: true };
}
