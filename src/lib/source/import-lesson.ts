import fs from "node:fs";
import path from "node:path";
import type { LessonRef } from "./catalog";
import { pad2, visualPrefixes } from "./visual-naming";

const SKIP_DIRS = new Set(["__pycache__", ".pytest_cache"]);
const SKIP_EXT = new Set([".pyc"]);

export interface ImportResult {
  slug: string;
  copied: string[];
  skipped: string[];
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) ? [] : walk(path.join(dir, entry.name));
    }
    return SKIP_EXT.has(path.extname(entry.name)) ? [] : [path.join(dir, entry.name)];
  });
}

function copyFile(courseRepo: string, sourceDir: string, abs: string, result: ImportResult): void {
  const rel = path.relative(courseRepo, abs);
  const target = path.join(sourceDir, rel);
  if (fs.existsSync(target)) {
    result.skipped.push(rel);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(abs, target);
  result.copied.push(rel);
}

function copyTree(courseRepo: string, sourceDir: string, relDir: string, result: ImportResult): void {
  const abs = path.join(courseRepo, relDir);
  if (!fs.existsSync(abs)) return;
  for (const file of walk(abs)) copyFile(courseRepo, sourceDir, file, result);
}

export function isImported(sourceDir: string, ref: LessonRef): boolean {
  return fs.existsSync(path.join(sourceDir, "phases", ref.phaseDir, ref.lessonDir, "docs"));
}

export function importLesson(courseRepo: string, sourceDir: string, ref: LessonRef): ImportResult {
  const result: ImportResult = { slug: ref.slug, copied: [], skipped: [] };

  copyTree(courseRepo, sourceDir, path.join("phases", ref.phaseDir, ref.lessonDir), result);
  copyTree(courseRepo, sourceDir, path.join("i18n", "ru", "phases", ref.phaseDir, ref.lessonDir), result);

  const visualsDir = path.join(courseRepo, "learning-visuals");
  if (fs.existsSync(visualsDir)) {
    const prefixes = visualPrefixes(ref);
    for (const name of fs.readdirSync(visualsDir)) {
      if (name.endsWith(".html") && prefixes.some((prefix) => name.startsWith(prefix))) {
        copyFile(courseRepo, sourceDir, path.join(visualsDir, name), result);
      }
    }
  }

  const exercisesRoot = path.join(courseRepo, "learning-exercises");
  if (fs.existsSync(exercisesRoot)) {
    const prefix = `p${pad2(ref.phaseNumber)}-l${pad2(ref.lessonNumber)}-`;
    const candidates = fs.readdirSync(exercisesRoot).filter((name) => name.startsWith(prefix));
    if (candidates.length > 1) {
      throw new Error(
        `Неоднозначное совпадение упражнения для ${ref.slug}: ${candidates.join(", ")}`,
      );
    }
    const found = candidates[0];
    if (found) copyTree(courseRepo, sourceDir, path.join("learning-exercises", found), result);
  }

  return result;
}
