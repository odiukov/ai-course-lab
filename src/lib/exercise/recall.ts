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
): { code: string; functions: ExerciseFunction[]; changed: boolean } | { error: string } {
  const exercise = readExerciseFiles(sourceDir, ref)?.files.find(
    (item) => item.name === "exercise.py",
  );
  if (!exercise) return { error: "У урока нет упражнения" };
  if (!exercise.functions.some((item) => item.fn === fn)) {
    return { error: `В упражнении этого урока нет функции ${fn} — вставить некуда` };
  }

  const code = replaceFunction(exercise.code, fn, previous.code);
  if (code === exercise.code) {
    return { code, functions: exercise.functions, changed: false };
  }

  const written = writeExerciseFile(sourceDir, ref, "exercise.py", code);
  return { code, functions: written.functions, changed: true };
}
