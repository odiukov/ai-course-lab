import fs from "node:fs";
import path from "node:path";
import { readWrittenFunctions } from "../source/written-functions";
import { extractFunction } from "./file";

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

  const file = path.join(sourceDir, "learning-exercises", latest.exerciseSlug, "exercise.py");
  if (!fs.existsSync(file)) return null;
  const code = extractFunction(fs.readFileSync(file, "utf8"), fn);
  if (!code) return null;

  return {
    fn,
    exerciseSlug: latest.exerciseSlug,
    lessonSlug: latest.lessonSlug,
    code,
  };
}
