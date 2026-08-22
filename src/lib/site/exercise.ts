import type { LessonRef } from "../source/catalog";
import { canonicalFunctions, readExerciseTree } from "../exercise/tree";

export interface ExerciseBundleFile {
  /** Имя файла внутри упражнения. У одно-файловой формы — всегда `exercise.py`. */
  name: string;
  templatePath: string;
  solutionPath: string | null;
}

export interface ExerciseBundle {
  /** Каталог упражнения: `p01-l01-linear-algebra-intuition`. */
  slug: string;
  dir: string;
  /**
   * Канонический состав упражнения — имена из шаблона, а не из чьего-то
   * exercise.py. По ним отбираются тесты шага, и список должен описывать
   * упражнение, а не то, что человек успел дописать.
   *
   * Для каталожной формы это все функции всех файлов подряд, в порядке
   * файлов (`main.py` первым, дальше по алфавиту): браузерный раннер
   * фильтрует тесты по имени функции, а не по файлу, и сегодня умеет
   * держать в редакторе только один файл разом — полноценные вкладки для
   * статической сборки это отдельная задача, не задача 10.
   */
  functions: string[];
  /** Каталожная форма (несколько файлов) против одно-файловой. */
  multi: boolean;
  files: ExerciseBundleFile[];
  testPath: string;
}

const LESSON_SLUG = /^(\d{2})-[^_]+__(\d{2})-/;

/**
 * Упражнение урока: заготовка, тесты и эталон.
 *
 * Урок и упражнение связаны только номерами фазы и урока (`p01-l01-`), и
 * ищется каталог тем же кодом, что в приложении: одно правило именования на
 * оба места. Форму (одно-файловую или каталожную) распознаёт `readExerciseTree`
 * — здесь достаточно превратить slug урока в номера фазы и урока, которые
 * ему и нужны.
 */
export function findLessonExercise(sourceDir: string, lessonSlug: string): ExerciseBundle | null {
  const match = LESSON_SLUG.exec(lessonSlug);
  if (!match) return null;

  const ref = {
    slug: lessonSlug,
    phaseNumber: Number(match[1]),
    lessonNumber: Number(match[2]),
  } as LessonRef;

  const tree = readExerciseTree(sourceDir, ref);
  // Без заготовки и тестов писать нечего и проверять нечем — как раньше.
  if (!tree || !tree.testPath) return null;

  return {
    slug: tree.slug,
    dir: tree.dir,
    functions: canonicalFunctions(tree).map((pair) => pair.fn),
    multi: tree.multi,
    files: tree.files.map((file) => ({
      name: file.name,
      templatePath: file.templatePath,
      solutionPath: file.solutionPath,
    })),
    testPath: tree.testPath,
  };
}

export interface ExerciseUrls {
  template: string;
  test: string;
  solution: string | null;
}

/**
 * Адреса файлов упражнения в собранном сайте.
 *
 * Браузерная практика правит один файл за раз (см. комментарий у
 * `functions`), поэтому здесь — адрес первого файла по порядку упражнения
 * (`main.py` для каталожной формы, единственный файл для одно-файловой).
 * Скачать остальные файлы каталожной формы можно, но в редактор практики
 * они не попадают — это задача за пределами задачи 10.
 */
export function exerciseUrls(basePath: string, bundle: ExerciseBundle): ExerciseUrls {
  const root = `${basePath}/exercise/${bundle.slug}`;
  const primary = bundle.files[0];
  const template = bundle.multi ? `${root}/template/${primary.name}` : `${root}/template.py`;
  const solution = primary.solutionPath
    ? bundle.multi
      ? `${root}/solution/${primary.name}`
      : `${root}/solution.py`
    : null;
  return { template, test: `${root}/test.py`, solution };
}

/**
 * Что скопировать в out/: пары «файл на диске → путь внутри сборки».
 *
 * Одно-файловая форма кладётся туда же, где лежала всегда (`template.py`,
 * `test.py`, `solution.py`) — эти адреса уже разошлись по опубликованному
 * сайту, и переезд сломал бы ссылки. Каталожная форма — в подкаталоги
 * `template/` и `solution/`, по одному файлу на имя; тесты остаются одним
 * `test.py` независимо от формы.
 */
export function exerciseFiles(bundle: ExerciseBundle): { from: string; to: string }[] {
  const root = `exercise/${bundle.slug}`;

  if (!bundle.multi) {
    const file = bundle.files[0];
    const files = [
      { from: file.templatePath, to: `${root}/template.py` },
      { from: bundle.testPath, to: `${root}/test.py` },
    ];
    if (file.solutionPath) files.push({ from: file.solutionPath, to: `${root}/solution.py` });
    return files;
  }

  const files = bundle.files.map((file) => ({
    from: file.templatePath,
    to: `${root}/template/${file.name}`,
  }));
  files.push({ from: bundle.testPath, to: `${root}/test.py` });
  for (const file of bundle.files) {
    if (file.solutionPath) files.push({ from: file.solutionPath, to: `${root}/solution/${file.name}` });
  }
  return files;
}
