// Переносит один урок из старого репозитория курса в source/.
// Запуск: node scripts/import-lesson.mjs 01-math-foundations__02-vectors-matrices-operations
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const force = args.includes("--force");
const slug = args.find((arg) => !arg.startsWith("--"));
if (!slug) {
  console.error("Укажи слаг урока, например 01-math-foundations__02-beta [--force]");
  process.exit(2);
}

const load = async (rel) => import(pathToFileURL(path.resolve(rel)).href);
const { loadConfig } = await load("src/lib/config.ts");
const config = loadConfig();

// The app tolerates a stale COURSE_REPO (reading imported lessons needs
// nothing from it); the importer must not. Refusing here is the point.
if (!config.courseRepo) {
  console.error("Курс недоступен: нет ни .cache/course-repo, ни валидного COURSE_REPO");
  process.exit(2);
}

const { findLesson } = await load("src/lib/source/catalog.ts");
const { importLesson } = await load("src/lib/source/import-lesson.ts");

const ref = findLesson(config.courseRepo, slug);
if (!ref) {
  console.error(`Урок ${slug} не найден в ${config.courseRepo}`);
  process.exit(1);
}

const result = importLesson(config.courseRepo, config.sourceDir, ref, { overwrite: force });
console.log(
  `${slug}: создано ${result.copied.length}, обновлено ${result.updated.length}, оставлено ${result.kept.length}`,
);
for (const rel of result.copied) console.log(`  + ${rel}`);
for (const rel of result.updated) console.log(`  ~ ${rel}`);
