// Карточки повторения и починка вопросов — отдельным процессом.
//
// Запуск:
//   npm run cards:write -- <slug>
//   npm run cards:write -- --phase 01
//
// Своя очередь агента на процесс — по той же причине, что у write-lesson.mts:
// очередь живёт в модуле, и два процесса пишут два урока одновременно.
//
// Починенные вопросы `check` дописываются во фронтматтер шага через writeStep,
// карточки ложатся отдельным файлом. Шаг, у которого вопросов не было, не
// трогается вовсе: новых вопросов проход не выдумывает.
import { isLimitError, isTimeoutError } from "../src/lib/agent/error-message.js";
import { defaultDeps } from "../src/lib/agent/factory.js";
import { auditLesson } from "../src/lib/cards/audit.js";
import type { Card } from "../src/lib/cards/card.js";
import { loadConfig, type Config } from "../src/lib/config.js";
import { readLessonPlan } from "../src/lib/content/lesson-plan.js";
import { readStepsById, writeStep } from "../src/lib/content/step-file.js";
import type { GenerateDeps } from "../src/lib/generate/plan-lesson.js";
import { writeCardsForStep } from "../src/lib/generate/write-cards.js";
import { resolveStepExcerpts } from "../src/lib/generate/write-step.js";
import { findLesson, readCatalog } from "../src/lib/source/catalog.js";
import { readLessonSource } from "../src/lib/source/lesson-source.js";

/**
 * Сколько таймаутов подряд считать упавшей сетью, а не бедой одного урока.
 *
 * Три: одиночный таймаут случается и на живой сети — урок бывает тяжёлый, — а
 * три кряду означают, что отвечать некому.
 */
const MAX_TIMEOUTS_IN_ROW = 3;

interface Args {
  slugs: string[];
  agent: "claude" | "codex" | null;
}

function parseArgs(argv: string[]): Args {
  const slugs: string[] = [];
  let agent: Args["agent"] = null;
  let phase: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--agent") {
      const value = argv[++i];
      if (value !== "claude" && value !== "codex") {
        throw new Error(`--agent принимает claude или codex, получено: ${value}`);
      }
      agent = value;
      continue;
    }
    if (arg === "--phase") {
      phase = argv[++i];
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Неизвестный ключ: ${arg}`);
    slugs.push(arg);
  }

  if (phase) {
    // Номер фазы, а не её каталог: «--phase 6» короче и не заставляет помнить
    // полное имя. Берутся только импортированные уроки — исходник урока лежит
    // в source/, и без него писать нечего.
    const number = Number(phase);
    if (!Number.isInteger(number)) throw new Error("--phase ждёт номер фазы, например 6");
    const config = loadConfig();
    const found = readCatalog(config.sourceDir).find((item) => item.number === number);
    if (!found) throw new Error(`Фаза ${number} в source/ не найдена — сначала импортируй уроки`);
    slugs.push(...found.lessons.map((lesson) => lesson.slug));
  }

  if (slugs.length === 0) throw new Error("Не передан ни один урок: <slug> или --phase NN");

  return { slugs, agent };
}

interface Report {
  slug: string;
  steps: number;
  cards: number;
  fixedCheck: number;
  rejected: { stepId: string; rules: string[] }[];
}

async function writeLessonCards(
  config: Config,
  slug: string,
  deps: GenerateDeps,
): Promise<Report> {
  const contentDir = config.contentDir;
  const plan = readLessonPlan(contentDir, slug);
  if (!plan) throw new Error(`Нет плана урока ${slug}`);

  // Материал вопросов — исходник курса, а не наш пересказ в теле шага, поэтому
  // без него проход не имеет смысла и падает сразу, а не пишет 54 карточки по
  // собственным метафорам.
  const ref = findLesson(config.sourceDir, slug);
  if (!ref) throw new Error(`Урока ${slug} нет в source/ — сначала импортируй его`);
  const source = readLessonSource(config.sourceDir, ref);
  // Срезы считаются один раз на урок и по всему плану сразу: курсор внутри
  // resolveStepExcerpts разводит шаги с одинаковым source_anchor по их
  // собственным вхождениям, а поштучный вызов схлопнул бы их на первое.
  const excerpts = resolveStepExcerpts(source, plan.steps);

  const ids = plan.steps.map((step) => step.id);
  const steps = readStepsById(contentDir, slug, ids);
  const report: Report = { slug, steps: 0, cards: 0, fixedCheck: 0, rejected: [] };
  const lessonCards: Card[] = [];

  for (const id of ids) {
    const step = steps[id];
    if (!step) {
      // План урока и файлы шага могут разъехаться (шаг удалили руками, план не
      // обновили) — без предупреждения дыра осталась бы незаметной в отчёте,
      // который человек читает перед диффом.
      console.warn(`[${slug}] шага ${id} нет на диске — пропускаю`);
      continue;
    }

    const result = await writeCardsForStep({
      contentDir,
      slug,
      step,
      source,
      sourceExcerpt: excerpts.get(id) ?? source.text,
      deps,
      lessonTitle: plan.title,
    });

    report.steps += 1;
    if (result.cards.length) {
      report.cards += result.cards.length;
      lessonCards.push(...result.cards);
    }
    if (result.check.length && step.check?.length) {
      writeStep(contentDir, slug, { ...step, check: result.check });
      report.fixedCheck += 1;
    }
    if (result.findings.some((finding) => finding.severity === "error")) {
      report.rejected.push({
        stepId: id,
        rules: [...new Set(result.findings.map((finding) => finding.rule))],
      });
    }
  }

  // Правила уровня урока считаются после всех шагов: одна карточка про ту же
  // идею, что и карточка соседнего шага, видна только отсюда.
  for (const finding of auditLesson(lessonCards)) {
    console.warn(`[${slug}] ${finding.rule}: ${finding.message}`);
  }

  return report;
}

function printReport(report: Report): void {
  console.log(
    `${report.slug}: шагов ${report.steps}, карточек ${report.cards}, ` +
      `починено вопросов ${report.fixedCheck}, забраковано шагов ${report.rejected.length}`,
  );
  for (const item of report.rejected) {
    console.log(`  ${item.stepId}: ${item.rules.join(", ")}`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { slugs, agent } = parseArgs(process.argv.slice(2));
  // Один раз на весь прогон: агент выбран заранее и не меняется от урока к
  // уроку, а loadConfig() внутри цикла на каждый шаг означало бы читать
  // конфиг с диска 54 раза на урок и 18000+ раз на курс.
  const deps = defaultDeps(config, agent ? { agent } : {});
  let timeoutsInRow = 0;
  // Один провалившийся урок посреди фазы не должен стоить оставшихся
  // четырнадцати — фаза стоит часы агентского времени. write-lesson.mts несёт
  // тот же список по той же причине.
  const failed: string[] = [];

  for (const slug of slugs) {
    try {
      printReport(await writeLessonCards(config, slug, deps));
      timeoutsInRow = 0;
    } catch (error) {
      if (isLimitError(error)) {
        console.error("Лимит исчерпан, останавливаюсь");
        process.exit(2);
      }
      if (isTimeoutError(error)) {
        timeoutsInRow += 1;
        if (timeoutsInRow >= MAX_TIMEOUTS_IN_ROW) {
          console.error("Три таймаута подряд — сеть лежит, останавливаюсь");
          process.exit(3);
        }
        continue;
      }
      console.error(`${slug}: не разобрался — ${(error as Error).message}`);
      failed.push(slug);
      timeoutsInRow = 0;
    }
  }

  if (failed.length > 0) {
    console.error(`\nНе разобрались: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

void main();
