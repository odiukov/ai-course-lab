import fs from "node:fs";
import path from "node:path";
import type { LessonRef } from "../source/catalog";
import { findExerciseDir } from "../source/naming";
import { parseTopLevelFunctions } from "../source/written-functions";

export interface ExerciseBundle {
  /** Каталог упражнения: `p01-l01-linear-algebra-intuition`. */
  slug: string;
  dir: string;
  /**
   * Канонический состав упражнения — имена из шаблона, а не из чьего-то
   * exercise.py. По ним отбираются тесты шага, и список должен описывать
   * упражнение, а не то, что человек успел дописать.
   */
  functions: string[];
  templatePath: string;
  testPath: string;
  solutionPath: string | null;
}

const LESSON_SLUG = /^(\d{2})-[^_]+__(\d{2})-/;

/**
 * Упражнение урока: заготовка, тесты и эталон.
 *
 * Урок и упражнение связаны только номерами фазы и урока (`p01-l01-`), и
 * ищется каталог тем же кодом, что в приложении: одно правило именования на
 * оба места.
 */
export function findLessonExercise(sourceDir: string, lessonSlug: string): ExerciseBundle | null {
  const match = LESSON_SLUG.exec(lessonSlug);
  if (!match) return null;

  const root = path.join(sourceDir, "learning-exercises");
  const ref = {
    slug: lessonSlug,
    phaseNumber: Number(match[1]),
    lessonNumber: Number(match[2]),
  } as LessonRef;

  const slug = findExerciseDir(root, ref);
  if (!slug) return null;

  const dir = path.join(root, slug);
  const templatePath = path.join(dir, "exercise.template.py");
  const testPath = path.join(dir, "test_exercise.py");
  const solutionPath = path.join(dir, "solution.py");

  // Без заготовки и тестов писать нечего и проверять нечем.
  if (!fs.existsSync(templatePath) || !fs.existsSync(testPath)) return null;

  return {
    slug,
    dir,
    functions: parseTopLevelFunctions(fs.readFileSync(templatePath, "utf8")).map(
      (block) => block.fn,
    ),
    templatePath,
    testPath,
    solutionPath: fs.existsSync(solutionPath) ? solutionPath : null,
  };
}

export interface ExerciseUrls {
  template: string;
  test: string;
  solution: string | null;
}

/** Адреса файлов упражнения в собранном сайте. */
export function exerciseUrls(basePath: string, bundle: ExerciseBundle): ExerciseUrls {
  const root = `${basePath}/exercise/${bundle.slug}`;
  return {
    template: `${root}/template.py`,
    test: `${root}/test.py`,
    solution: bundle.solutionPath ? `${root}/solution.py` : null,
  };
}

/** Что скопировать в out/: пары «файл на диске → путь внутри сборки». */
export function exerciseFiles(bundle: ExerciseBundle): { from: string; to: string }[] {
  const root = `exercise/${bundle.slug}`;
  const files = [
    { from: bundle.templatePath, to: `${root}/template.py` },
    { from: bundle.testPath, to: `${root}/test.py` },
  ];
  if (bundle.solutionPath) files.push({ from: bundle.solutionPath, to: `${root}/solution.py` });
  return files;
}
