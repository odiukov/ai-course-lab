// Последовательно дописывает указанные диапазоны экранов существующих уроков.
// Сами старые файлы скрипт намеренно не удаляет: перед запуском их нужно
// вынести в резервную копию, чтобы операция оставалась обратимой.
//
// Запуск через tsx:
//   npx tsx scripts/rewrite-lesson-steps.mjs lesson-slug:0 other-slug:43

import path from "node:path";
import { pathToFileURL } from "node:url";

const specs = process.argv.slice(2).map((raw) => {
  const separator = raw.lastIndexOf(":");
  if (separator <= 0) throw new Error(`Ожидался аргумент lesson-slug:from, получено: ${raw}`);
  const slug = raw.slice(0, separator);
  const fromIndex = Number(raw.slice(separator + 1));
  if (!Number.isInteger(fromIndex) || fromIndex < 0) {
    throw new Error(`Начальный индекс должен быть целым числом ≥ 0: ${raw}`);
  }
  return { slug, fromIndex };
});

if (specs.length === 0) {
  console.error("Укажи хотя бы один диапазон в форме lesson-slug:from");
  process.exit(2);
}

const load = async (relative) => import(pathToFileURL(path.resolve(relative)).href);
const { loadConfig } = await load("src/lib/config.ts");
const { defaultDeps } = await load("src/lib/agent/factory.ts");
const { readLessonPlan } = await load("src/lib/content/lesson-plan.ts");
const { ensureSteps } = await load("src/lib/generate/write-step.ts");
const { openProgressDb } = await load("src/lib/progress/db.ts");
const { readAgent } = await load("src/lib/progress/settings.ts");
const { findLesson } = await load("src/lib/source/catalog.ts");
const { readLessonSource } = await load("src/lib/source/lesson-source.ts");

const config = loadConfig();
const agent = readAgent(openProgressDb(config.dataDir), config.agent);
const deps = defaultDeps(config, { agent });

for (const { slug, fromIndex } of specs) {
  const ref = findLesson(config.sourceDir, slug);
  if (!ref) throw new Error(`Исходник урока не найден: ${slug}`);
  const source = readLessonSource(config.sourceDir, ref);
  const plan = readLessonPlan(config.contentDir, slug);
  if (!plan) throw new Error(`План урока не найден: ${slug}`);
  if (fromIndex >= plan.steps.length) {
    console.log(`${slug}: диапазон пуст, from=${fromIndex}, всего=${plan.steps.length}`);
    continue;
  }

  console.log(`${slug}: START from=${fromIndex + 1} total=${plan.steps.length}`);
  const written = await ensureSteps({
    contentDir: config.contentDir,
    source,
    plan,
    fromIndex,
    count: plan.steps.length - fromIndex,
    deps,
    onStep: ({ number, total, title }) => console.log(`${slug}: ${number}/${total} ${title}`),
    onVisualError: (stepId, problem) => console.error(`${slug}: visual ${stepId}: ${problem}`),
  });
  console.log(`${slug}: DONE written=${written.length}`);
}
