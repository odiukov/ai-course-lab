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

function copyTree(courseRepo: string, sourceDir: string, relDir: string, result: ImportResult, overwrite: boolean): void {
  const abs = path.join(courseRepo, relDir);
  if (!fs.existsSync(abs)) return;
  for (const file of walk(abs)) copyFile(courseRepo, sourceDir, file, result, overwrite);
}

export function isImported(sourceDir: string, ref: LessonRef): boolean {
  return fs.existsSync(path.join(sourceDir, "phases", ref.phaseDir, ref.lessonDir, "docs"));
}

export function importLesson(
  courseRepo: string,
  sourceDir: string,
  ref: LessonRef,
  options: ImportOptions = {},
): ImportResult {
  const overwrite = options.overwrite ?? false;
  const result: ImportResult = { slug: ref.slug, copied: [], updated: [], kept: [] };

  copyTree(courseRepo, sourceDir, path.join("phases", ref.phaseDir, ref.lessonDir), result, overwrite);
  copyTree(courseRepo, sourceDir, path.join("i18n", "ru", "phases", ref.phaseDir, ref.lessonDir), result, overwrite);

  const visualsDir = path.join(courseRepo, "learning-visuals");
  if (fs.existsSync(visualsDir)) {
    const prefixes = visualPrefixes(ref);
    for (const name of fs.readdirSync(visualsDir)) {
      if (name.endsWith(".html") && prefixes.some((prefix) => name.startsWith(prefix))) {
        copyFile(courseRepo, sourceDir, path.join(visualsDir, name), result, overwrite);
      }
    }
  }

  const found = findExerciseDir(path.join(courseRepo, "learning-exercises"), ref);
  if (found) copyTree(courseRepo, sourceDir, path.join("learning-exercises", found), result, overwrite);

  return result;
}
