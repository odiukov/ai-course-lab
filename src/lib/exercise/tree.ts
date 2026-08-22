import fs from "node:fs";
import path from "node:path";
import type { LessonRef } from "../source/catalog";
import { findExerciseDir } from "../source/naming";
import { parseTopLevelFunctions } from "../source/written-functions";

export interface ExerciseFileRef {
  /** Имя файла внутри упражнения. У старой формы — всегда `exercise.py`. */
  name: string;
  templatePath: string;
  /** Файл, который правит человек. */
  workPath: string;
  solutionPath: string | null;
}

export interface ExerciseTree {
  slug: string;
  dir: string;
  /** Каталожная форма (`exercise.template/`) против одно-файловой. */
  multi: boolean;
  files: ExerciseFileRef[];
  testPath: string | null;
  /**
   * Имена функций, встречающиеся больше чем в одном файле упражнения.
   *
   * Нужны не для красоты: фильтр `pytest -k` сравнивает подстроку с именем
   * теста и про файлы ничего не знает. Совпавшее имя означает, что отбор
   * тестов шага собрал бы чужие тесты, и лучше прогнать файл целиком с
   * предупреждением, чем покрасить шаг за соседний модуль.
   */
  duplicateFunctions: string[];
}

const SAFE_NAME = /^[A-Za-z0-9_-]+\.py$/;

/**
 * Порядок файлов упражнения: `main.py` первым, остальные по алфавиту.
 *
 * Порядок readdir зависит от файловой системы, а от этого порядка зависят
 * табы редактора и то, какой файл откроется первым. «Как отдал диск» здесь
 * означало бы, что на другой машине упражнение открывается с другого файла.
 */
function orderNames(names: string[]): string[] {
  const rest = names.filter((name) => name !== "main.py").sort();
  return names.includes("main.py") ? ["main.py", ...rest] : rest;
}

export function readExerciseTree(sourceDir: string, ref: LessonRef): ExerciseTree | null {
  const root = path.join(sourceDir, "learning-exercises");
  const slug = findExerciseDir(root, ref);
  if (!slug) return null;

  const dir = path.join(root, slug);
  const testPathCandidate = path.join(dir, "test_exercise.py");
  const testPath = fs.existsSync(testPathCandidate) ? testPathCandidate : null;

  const templateDir = path.join(dir, "exercise.template");
  const multi = fs.existsSync(templateDir) && fs.statSync(templateDir).isDirectory();

  const files: ExerciseFileRef[] = [];
  if (multi) {
    const names = orderNames(
      fs.readdirSync(templateDir).filter((name) => SAFE_NAME.test(name)),
    );
    for (const name of names) {
      const solution = path.join(dir, "solution", name);
      files.push({
        name,
        templatePath: path.join(templateDir, name),
        workPath: path.join(dir, "exercise", name),
        solutionPath: fs.existsSync(solution) ? solution : null,
      });
    }
  } else {
    const template = path.join(dir, "exercise.template.py");
    if (!fs.existsSync(template)) return null;
    const solution = path.join(dir, "solution.py");
    files.push({
      name: "exercise.py",
      templatePath: template,
      workPath: path.join(dir, "exercise.py"),
      solutionPath: fs.existsSync(solution) ? solution : null,
    });
  }

  if (files.length === 0) return null;

  return { slug, dir, multi, files, testPath, duplicateFunctions: duplicates(files) };
}

function duplicates(files: ExerciseFileRef[]): string[] {
  const seen = new Map<string, number>();
  for (const file of files) {
    if (!fs.existsSync(file.templatePath)) continue;
    const source = fs.readFileSync(file.templatePath, "utf8");
    for (const block of parseTopLevelFunctions(source)) {
      seen.set(block.fn, (seen.get(block.fn) ?? 0) + 1);
    }
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([fn]) => fn).sort();
}

/**
 * Файл упражнения по имени — и `null` на всё, чего в шаблоне нет.
 *
 * Имя приходит из запроса, а из него собирается путь записи. Проверка формы
 * (`SAFE_NAME`) здесь не помогла бы одна: `main.py` из чужого упражнения тоже
 * проходит форму. Правда — состав шаблона, поэтому сверка идёт со списком.
 */
export function findTreeFile(tree: ExerciseTree, name: string): ExerciseFileRef | null {
  return tree.files.find((file) => file.name === name) ?? null;
}

/** Канонический состав упражнения — из шаблона, а не из файла человека. */
export function canonicalFunctions(tree: ExerciseTree): { file: string; fn: string }[] {
  const pairs: { file: string; fn: string }[] = [];
  for (const file of tree.files) {
    if (!fs.existsSync(file.templatePath)) continue;
    for (const block of parseTopLevelFunctions(fs.readFileSync(file.templatePath, "utf8"))) {
      pairs.push({ file: file.name, fn: block.fn });
    }
  }
  return pairs;
}

/**
 * Разрешает имя файла для функции шага — одним правилом на маршруты тестов,
 * сброса и recall, чтобы каждый не угадывал его по-своему.
 *
 * Объявленный файл (`step.exercise_file` или `body.file` из запроса)
 * побеждает всегда — он единственный источник правды, когда имя функции
 * неоднозначно. Без него: у одно-файловой формы файл ровно один,
 * `exercise.py`, — старый контракт, который эта форма обязана видеть
 * неизменным. У каталожной формы без объявления берётся файл, где функция
 * единственная, — обычный случай для планов, написанных до многофайловых
 * упражнений, у которых `exercise_file` в принципе нет.
 *
 * Если функция при этом всё равно встречается в нескольких файлах,
 * `plan-lesson.ts` должен был потребовать `exercise_file` ещё на этапе
 * валидации плана — сюда с необъявленным файлом это дойти не должно. Раз уж
 * дошло (рассинхронизировавшийся план, ручная правка), берём первый файл по
 * порядку шаблона (`canonicalFunctions` идёт в этом же порядке) — том самом,
 * в котором открываются вкладки редактора, — а не бросаем ошибку: маршруты
 * уже отработали случай «функции нигде нет» до вызова этого помощника, и
 * вернуть хоть какой-то файл лучше, чем уронить запрос из-за рассинхрона,
 * который не имеет отношения к тому, что делает учащийся сейчас.
 */
export function resolveExerciseFile(tree: ExerciseTree, fn: string, declared?: string): string {
  if (declared) return declared;
  if (!tree.multi) return "exercise.py";
  const owner = canonicalFunctions(tree).find((pair) => pair.fn === fn);
  return owner?.file ?? tree.files[0]?.name ?? "exercise.py";
}
