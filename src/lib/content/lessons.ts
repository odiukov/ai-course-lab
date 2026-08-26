import fs from "node:fs";
import path from "node:path";

/**
 * Слаги уроков — по каталогам на диске, а не по индексу.
 *
 * Индекса уроков в проекте нет намеренно: уроки появляются импортом по одному,
 * и каталог на диске всегда честнее любого списка, который надо не забыть
 * обновить.
 */
export function lessonSlugs(contentDir: string): string[] {
  const lessonsDir = path.join(contentDir, "lessons");
  if (!fs.existsSync(lessonsDir)) return [];
  return fs
    .readdirSync(lessonsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
