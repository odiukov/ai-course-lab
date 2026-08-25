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
import { loadConfig } from "../src/lib/config.js";
import { readLessonPlan } from "../src/lib/content/lesson-plan.js";
import { readStepsById, writeStep } from "../src/lib/content/step-file.js";
import { writeCardsForStep } from "../src/lib/generate/write-cards.js";
import { readCatalog } from "../src/lib/source/catalog.js";

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
  contentDir: string,
  slug: string,
  agent: "claude" | "codex" | null,
): Promise<Report> {
  const plan = readLessonPlan(contentDir, slug);
  if (!plan) throw new Error(`Нет плана урока ${slug}`);

  const ids = plan.steps.map((step) => step.id);
  const steps = readStepsById(contentDir, slug, ids);
  const report: Report = { slug, steps: 0, cards: 0, fixedCheck: 0, rejected: [] };
  const lessonCards: Card[] = [];

  for (const id of ids) {
    const step = steps[id];
    if (!step) continue;

    const deps = defaultDeps(loadConfig(), agent ? { agent } : {});
    const result = await writeCardsForStep({
      contentDir,
      slug,
      step,
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
  let timeoutsInRow = 0;

  for (const slug of slugs) {
    try {
      printReport(await writeLessonCards(config.contentDir, slug, agent));
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
      throw error;
    }
  }
}

void main();
