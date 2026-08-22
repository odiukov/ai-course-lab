import fs from "node:fs";
import path from "node:path";
import type { LessonRef } from "../source/catalog";
import { findExerciseDir } from "../source/naming";
import { parseExerciseTargets, parseTopLevelFunctions } from "../source/written-functions";

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
  /** Все корневые pytest-файлы: авторский suite и узкие тесты шагов. */
  testPaths: string[];
  /** Явные цели новой формы. null сохраняет старое выведение по функциям. */
  targets: ExerciseTargetRef[] | null;
  /** Импортируемые Python-модули, без которых лаборатория не запустится. */
  requirements: string[];
  /** Лаборатория проверяет сетевой сценарий и не обещает офлайн-прогон. */
  network: boolean;
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

export interface ExerciseTargetRef {
  file: string;
  /** Bare function или квалифицированный метод `Class.method`. */
  fn: string;
  /** Точные pytest node IDs относительно каталога упражнения. */
  tests: string[];
  /** Runtime-бенч допустим только когда цель можно вызвать как функцию модуля. */
  bench: boolean;
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
  const testPaths = orderTestPaths(
    fs.readdirSync(dir)
      .filter((name) => /^test[A-Za-z0-9_-]*\.py$/.test(name))
      .map((name) => path.join(dir, name)),
  );
  const testPath = testPaths.find((file) => path.basename(file) === "test_exercise.py") ?? null;

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

  const manifest = readManifest(dir, files, testPaths);
  const tree: ExerciseTree = {
    slug,
    dir,
    multi,
    files,
    testPath,
    testPaths,
    targets: manifest?.targets ?? null,
    requirements: manifest?.requirements ?? [],
    network: manifest?.network ?? false,
    duplicateFunctions: [],
  };
  tree.duplicateFunctions = duplicates(tree);
  return tree;
}

function orderTestPaths(files: string[]): string[] {
  return files.sort((a, b) => {
    const an = path.basename(a);
    const bn = path.basename(b);
    if (an === "test_exercise.py") return -1;
    if (bn === "test_exercise.py") return 1;
    return an.localeCompare(bn);
  });
}

function readManifest(
  dir: string,
  files: ExerciseFileRef[],
  testPaths: string[],
): { targets: ExerciseTargetRef[]; requirements: string[]; network: boolean } | null {
  const manifestPath = path.join(dir, "exercise.json");
  if (!fs.existsSync(manifestPath)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Не удалось прочитать ${manifestPath}: ${(error as Error).message}`);
  }
  if (!raw || typeof raw !== "object" || (raw as { version?: unknown }).version !== 1) {
    throw new Error(`В ${manifestPath} нужна версия 1`);
  }
  const manifest = raw as { targets?: unknown; requirements?: unknown; network?: unknown };
  const declared = manifest.targets;
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error(`В ${manifestPath} нет targets`);
  }

  const knownTests = new Set(testPaths.map((file) => path.basename(file)));
  const seen = new Set<string>();
  const targets = declared.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Цель ${index + 1} в ${manifestPath} должна быть объектом`);
    }
    const value = item as { file?: unknown; symbol?: unknown; tests?: unknown; bench?: unknown };
    const file = typeof value.file === "string" ? value.file : "";
    const fn = typeof value.symbol === "string" ? value.symbol : "";
    const tests = Array.isArray(value.tests)
      ? value.tests.filter((test): test is string => typeof test === "string" && test.length > 0)
      : [];
    const ref = files.find((candidate) => candidate.name === file);
    if (!ref) throw new Error(`В упражнении нет файла цели ${file || "(пусто)"}`);
    const available = parseExerciseTargets(fs.readFileSync(ref.templatePath, "utf8"));
    if (!available.some((target) => target.symbol === fn)) {
      throw new Error(`В шаблоне ${file} нет цели ${fn || "(пусто)"}`);
    }
    if (tests.length === 0 || tests.length !== (value.tests as unknown[]).length) {
      throw new Error(`У цели ${file}::${fn} нет корректных pytest node IDs`);
    }
    for (const test of tests) {
      const testFile = test.split("::", 1)[0];
      if (test.includes("..") || test.includes("/") || test.includes("\\") || !knownTests.has(testFile)) {
        throw new Error(`У цели ${file}::${fn} небезопасный pytest node ID: ${test}`);
      }
    }
    const key = `${file}::${fn}`;
    if (seen.has(key)) throw new Error(`Цель ${key} объявлена в ${manifestPath} дважды`);
    seen.add(key);
    return {
      file,
      fn,
      tests,
      // Метод требует экземпляра и состояния, которых общий bench.py не знает.
      bench: typeof value.bench === "boolean" ? value.bench : !fn.includes("."),
    };
  });
  const requirements = Array.isArray(manifest.requirements)
    ? manifest.requirements.filter(
        (item): item is string =>
          typeof item === "string" && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(item),
      )
    : [];
  if (
    manifest.requirements !== undefined &&
    (!Array.isArray(manifest.requirements) || requirements.length !== manifest.requirements.length)
  ) {
    throw new Error(`В ${manifestPath} requirements должен содержать имена Python-модулей`);
  }
  if (manifest.network !== undefined && typeof manifest.network !== "boolean") {
    throw new Error(`В ${manifestPath} network должен быть boolean`);
  }
  return {
    targets,
    requirements: [...new Set(requirements)].sort(),
    network: manifest.network === true,
  };
}

function duplicates(tree: Pick<ExerciseTree, "files" | "targets">): string[] {
  const seen = new Map<string, number>();
  if (tree.targets) {
    for (const target of tree.targets) {
      seen.set(target.fn, (seen.get(target.fn) ?? 0) + 1);
    }
    return [...seen.entries()].filter(([, count]) => count > 1).map(([fn]) => fn).sort();
  }
  for (const file of tree.files) {
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
  if (tree.targets) return tree.targets.map(({ file, fn }) => ({ file, fn }));
  const pairs: { file: string; fn: string }[] = [];
  for (const file of tree.files) {
    if (!fs.existsSync(file.templatePath)) continue;
    for (const block of parseTopLevelFunctions(fs.readFileSync(file.templatePath, "utf8"))) {
      pairs.push({ file: file.name, fn: block.fn });
    }
  }
  return pairs;
}

export function findExerciseTarget(
  tree: ExerciseTree,
  file: string,
  fn: string,
): ExerciseTargetRef | null {
  return tree.targets?.find((target) => target.file === file && target.fn === fn) ?? null;
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
