import type { LessonRef } from "../source/catalog";
import { readWrittenFunctions } from "../source/written-functions";
import {
  extractFunction,
  readExerciseCodeBySlug,
  readExerciseFile,
  replaceFunction,
  writeExerciseCode,
  type ExerciseFunction,
} from "./file";

export interface PreviousImplementation {
  fn: string;
  exerciseSlug: string;
  lessonSlug: string | null;
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

  const source = readExerciseCodeBySlug(sourceDir, latest.exerciseSlug);
  if (!source) return null;
  const code = extractFunction(source, fn);
  if (!code) return null;

  return {
    fn,
    exerciseSlug: latest.exerciseSlug,
    lessonSlug: latest.lessonSlug,
    code,
  };
}

/**
 * Вставляет прошлую реализацию на место заготовки в упражнении текущего
 * урока и пишет результат на диск. Отдаёт `{ error }`, если у урока нет
 * упражнения или в нём вообще нет функции `fn` — заменять там нечего, и
 * возвращать успех при неизменившемся файле было бы ложью учащемуся.
 */
export function insertPreviousImplementation(
  sourceDir: string,
  ref: LessonRef,
  fn: string,
  previous: PreviousImplementation,
): { code: string; functions: ExerciseFunction[] } | { error: string } {
  const exercise = readExerciseFile(sourceDir, ref);
  if (!exercise) return { error: "У урока нет упражнения" };

  const code = replaceFunction(exercise.code, fn, previous.code);
  if (code === exercise.code) {
    return { error: `В упражнении этого урока нет функции ${fn} — вставить некуда` };
  }

  const written = writeExerciseCode(sourceDir, ref, code);
  return { code, functions: written.functions };
}
