// Переносит один урок из старого репозитория курса в source/.
// Запуск: node scripts/import-lesson.mjs 01-math-foundations__02-vectors-matrices-operations
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const slug = process.argv[2];
if (!slug) {
  console.error("Укажи слаг урока, например 01-math-foundations__02-beta");
  process.exit(2);
}

const courseRepo = process.env.COURSE_REPO;
if (!courseRepo) {
  console.error("COURSE_REPO не задан — неоткуда импортировать");
  process.exit(2);
}

// The app tolerates a stale COURSE_REPO (reading imported lessons needs
// nothing from it); the importer must not. Refusing here is the point.
const resolvedRepo = path.resolve(courseRepo);
if (!fs.existsSync(resolvedRepo) || !fs.statSync(resolvedRepo).isDirectory()) {
  console.error(`Директория курса для импорта не найдена: ${resolvedRepo}`);
  process.exit(2);
}

const load = async (rel) => import(pathToFileURL(path.resolve(rel)).href);
const { findLesson } = await load("src/lib/source/catalog.ts");
const { importLesson } = await load("src/lib/source/import-lesson.ts");

const ref = findLesson(resolvedRepo, slug);
if (!ref) {
  console.error(`Урок ${slug} не найден в ${resolvedRepo}`);
  process.exit(1);
}

const result = importLesson(resolvedRepo, path.resolve("source"), ref);
console.log(
  `${slug}: создано ${result.copied.length}, обновлено ${result.updated.length}, оставлено ${result.kept.length}`,
);
for (const rel of result.copied) console.log(`  + ${rel}`);
for (const rel of result.updated) console.log(`  ~ ${rel}`);
