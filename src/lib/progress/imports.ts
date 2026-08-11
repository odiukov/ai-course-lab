import type { DatabaseSync } from "node:sqlite";
import { execute, queryAll, queryOne } from "./db";

/**
 * Когда урок в последний раз импортировали.
 *
 * Хранится у нас, а не выводится из файлов: mtime в source/ сдвигает любая
 * правка руками, и «импортирован 5 минут назад» тогда означало бы «я поправил
 * там опечатку».
 */
export function recordImport(db: DatabaseSync, slug: string, at: Date = new Date()): void {
  execute(
    db,
    `INSERT INTO lesson_imports (lesson_slug, imported_at) VALUES (?, ?)
     ON CONFLICT(lesson_slug) DO UPDATE SET imported_at = excluded.imported_at`,
    slug,
    at.toISOString(),
  );
}

export function lastImportAt(db: DatabaseSync, slug: string): string | null {
  const row = queryOne<{ imported_at: string }>(
    db,
    "SELECT imported_at FROM lesson_imports WHERE lesson_slug = ?",
    slug,
  );
  return row?.imported_at ?? null;
}

/** Все даты импорта разом: каталог рисует сотни строк за один проход. */
export function readImportDates(db: DatabaseSync): Map<string, string> {
  const rows = queryAll<{ lesson_slug: string; imported_at: string }>(
    db,
    "SELECT lesson_slug, imported_at FROM lesson_imports",
  );
  return new Map(rows.map((row) => [row.lesson_slug, row.imported_at]));
}
