// Переносит один урок из старого репозитория курса в source/.
// Запуск: node scripts/import-lesson.mjs 01-math-foundations__02-vectors-matrices-operations
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

const load = async (rel) => import(pathToFileURL(path.resolve(rel)).href);
const { findLesson } = await load("src/lib/source/catalog.ts");
const { importLesson } = await load("src/lib/source/import-lesson.ts");

const ref = findLesson(courseRepo, slug);
if (!ref) {
  console.error(`Урок ${slug} не найден в ${courseRepo}`);
  process.exit(1);
}

const result = importLesson(courseRepo, path.resolve("source"), ref);
console.log(`${slug}: скопировано ${result.copied.length}, пропущено ${result.skipped.length}`);
for (const rel of result.copied) console.log(`  + ${rel}`);
