import fs from "node:fs";
import path from "node:path";
import type { LessonRef } from "./catalog";
import { findExerciseDir, visualPrefixes } from "./naming";

const SKIP_DIRS = new Set(["__pycache__", ".pytest_cache"]);
const SKIP_EXT = new Set([".pyc"]);

const LEARNER_OWNED = /^learning-exercises\/[^/]+\/exercise\.py$/;

/**
 * Файл, который принадлежит учащемуся, а не курсу.
 *
 * Правило явное, а не «сравним с шаблоном»: решение, случайно совпавшее с
 * заготовкой, всё равно остаётся работой учащегося, и отката у перезаписи нет.
 */
export function isLearnerOwned(rel: string): boolean {
  return LEARNER_OWNED.test(rel.split(path.sep).join("/"));
}

function sameContent(a: string, b: string): boolean {
  return fs.readFileSync(a).equals(fs.readFileSync(b));
}

export interface ImportResult {
  slug: string;
  /** Файлы, которых в source/ не было. */
  copied: string[];
  /** Файлы, перезаписанные версией из курса. */
  updated: string[];
  /** Файлы, оставленные как есть: защищённые или совпавшие байт-в-байт. */
  kept: string[];
}

export interface ImportOptions {
  overwrite?: boolean;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) ? [] : walk(path.join(dir, entry.name));
    }
    return SKIP_EXT.has(path.extname(entry.name)) ? [] : [path.join(dir, entry.name)];
  });
}

function copyFile(
  courseRepo: string,
  sourceDir: string,
  abs: string,
  result: ImportResult,
  overwrite: boolean,
): void {
  const rel = path.relative(courseRepo, abs);
  const target = path.join(sourceDir, rel);

  if (fs.existsSync(target)) {
    if (!overwrite || isLearnerOwned(rel) || sameContent(abs, target)) {
      result.kept.push(rel);
      return;
    }
    fs.copyFileSync(abs, target);
    result.updated.push(rel);
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(abs, target);
  result.copied.push(rel);
}

export function isImported(sourceDir: string, ref: LessonRef): boolean {
  return fs.existsSync(path.join(sourceDir, "phases", ref.phaseDir, ref.lessonDir, "docs"));
}

export interface LessonFile {
  /** Репозиторий, от которого считается относительный путь файла. */
  repo: string;
  abs: string;
}

/**
 * Материал урока и репозиторий, из которого взята каждая его часть.
 *
 * Репозиториев несколько, потому что курс не лежит в одном месте. Тексты и
 * переводы живут в рут-репозитории и там же обновляются, а `learning-exercises`
 * и `learning-visuals` есть только в форке — их завёл владелец лабы, в апстриме
 * этих каталогов нет вовсе. Правило простое и не требует настройки: каждая
 * группа берётся из ПЕРВОГО репозитория списка, где она вообще есть. Если
 * апстрим когда-нибудь заведёт упражнения, они начнут выигрывать сами.
 *
 * Одно место, где живёт ответ «из чего состоит урок»: и импорт, и подсчёт
 * «есть ли что обновлять» обязаны понимать состав одинаково, иначе строка
 * каталога обещала бы одно, а кнопка приносила другое.
 */
export function lessonFiles(repos: string | string[], ref: LessonRef): LessonFile[] {
  return collectLessonFiles(repos, ref).filter(
    ({ repo, abs }) => !isLearnerOwned(path.relative(repo, abs)),
  );
}

/**
 * То же самое, но без отсева файлов учащегося.
 *
 * Отсев вынесен наружу, потому что он касается ИМПОРТА, а не состава урока:
 * `exercise.py` в репозитории курса — это чьё-то решение, и приехать оно не
 * должно ни при первом импорте, ни при реимпорте. Защита «не перезаписывать»
 * тут не спасала: перезаписывать нечего, файл просто копировался как новый, и
 * урок приезжал пред-решённым. Дальше readWrittenFunctions видел все функции
 * написанными, а планировщик по своему правилу превращал практику в recall —
 * урок из восьми задач терял семь.
 */
function collectLessonFiles(repos: string | string[], ref: LessonRef): LessonFile[] {
  const list = (Array.isArray(repos) ? repos : [repos]).filter(
    (repo, index, all) => repo && all.indexOf(repo) === index,
  );
  const files: LessonFile[] = [];

  // Первый репозиторий, у которого этот каталог есть. Пустой каталог — это
  // «группы здесь нет», а не «группа пустая»: незачем считать источником репо,
  // из которого не приедет ни файла.
  const pick = (relDir: string): LessonFile[] | null => {
    for (const repo of list) {
      const abs = path.join(repo, relDir);
      if (!fs.existsSync(abs)) continue;
      const found = walk(abs);
      if (found.length > 0) return found.map((file) => ({ repo, abs: file }));
    }
    return null;
  };

  files.push(...(pick(path.join("phases", ref.phaseDir, ref.lessonDir)) ?? []));
  files.push(...(pick(path.join("i18n", "ru", "phases", ref.phaseDir, ref.lessonDir)) ?? []));

  for (const repo of list) {
    const visualsDir = path.join(repo, "learning-visuals");
    if (!fs.existsSync(visualsDir)) continue;
    const prefixes = visualPrefixes(ref);
    const matched = fs
      .readdirSync(visualsDir)
      .filter((name) => name.endsWith(".html") && prefixes.some((prefix) => name.startsWith(prefix)))
      .map((name) => ({ repo, abs: path.join(visualsDir, name) }));
    if (matched.length > 0) {
      files.push(...matched);
      break;
    }
  }

  for (const repo of list) {
    const found = findExerciseDir(path.join(repo, "learning-exercises"), ref);
    if (!found) continue;
    files.push(...(pick(path.join("learning-exercises", found)) ?? []));
    break;
  }

  return files;
}

export function importLesson(
  repos: string | string[],
  sourceDir: string,
  ref: LessonRef,
  options: ImportOptions = {},
): ImportResult {
  const overwrite = options.overwrite ?? false;
  const result: ImportResult = { slug: ref.slug, copied: [], updated: [], kept: [] };

  for (const { repo, abs } of lessonFiles(repos, ref)) {
    copyFile(repo, sourceDir, abs, result, overwrite);
  }

  return result;
}

export interface LessonDiff {
  /** Файлов, которых в source/ ещё нет. */
  added: number;
  /** Файлов, которые реимпорт перезаписал бы. */
  changed: number;
}

/**
 * Что принёс бы реимпорт прямо сейчас — без единой записи на диск.
 *
 * Отвечает на вопрос «стоит ли жать „Обновить“» точнее, чем дата коммита:
 * учитывает и правки, сделанные в source/ руками, и молчит про урок, чью
 * папку в курсе трогали, но ничего из импортируемого не изменили.
 *
 * Считается по кэшу апстрима в том виде, в каком он лежит на диске. Свежий
 * fetch может принести ещё что-то, поэтому ноль здесь — это «в известной
 * копии курса нового нет», а не «жать бессмысленно».
 */
export function diffLesson(
  repos: string | string[],
  sourceDir: string,
  ref: LessonRef,
): LessonDiff {
  const diff: LessonDiff = { added: 0, changed: 0 };

  for (const { repo, abs } of lessonFiles(repos, ref)) {
    const rel = path.relative(repo, abs);
    const target = path.join(sourceDir, rel);

    if (!fs.existsSync(target)) {
      diff.added += 1;
      continue;
    }
    if (isLearnerOwned(rel) || sameContent(abs, target)) continue;
    diff.changed += 1;
  }

  return diff;
}
