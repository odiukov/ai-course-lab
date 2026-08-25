// Проверка уже написанных карточек и вопросов — без агента.
//
// Запуск:
//   npm run audit:cards
//   npm run audit:cards -- --phase 01
//
// Это ворота между фазами: прогон по фазе, отчёт, глаза, «дальше». Код 1 при
// хотя бы одной ошибке; предупреждения на код возврата не влияют.
import { auditCheck, auditLesson, auditStep, type Finding } from "../src/lib/cards/audit.js";
import { readCards, type Card } from "../src/lib/cards/card.js";
import { loadConfig } from "../src/lib/config.js";
import { readLessonPlan } from "../src/lib/content/lesson-plan.js";
import { lessonSlugs } from "../src/lib/content/lessons.js";
import { readStepsById } from "../src/lib/content/step-file.js";

function auditLessonFiles(contentDir: string, slug: string): Finding[] {
  const plan = readLessonPlan(contentDir, slug);
  // Не у каждого урока в content/lessons есть план — импорт мог остановиться
  // раньше. Без плана нечего аудировать: это не ошибка аудита, а нормальный
  // промежуточный статус урока.
  if (!plan) return [];

  const ids = plan.steps.map((step) => step.id);
  const steps = readStepsById(contentDir, slug, ids);
  const findings: Finding[] = [];
  // Аннотация обязательна: без неё const lessonCards = [] выводится как
  // implicit any[] и strict-режим tsc валит typecheck.
  const lessonCards: Card[] = [];

  for (const id of ids) {
    const step = steps[id];
    if (!step) continue;

    // readCards возвращает null, когда файла карточек ещё нет — это норма
    // для урока, до которого проход генерации ещё не дошёл, а не повод упасть.
    const cards = readCards(contentDir, slug, id);
    if (cards) {
      findings.push(...auditStep(cards, step.body));
      lessonCards.push(...cards);
    }
    if (step.check?.length) findings.push(...auditCheck(step.check, step.body));
  }

  // Дубликаты идей видны только на уровне всего урока, поэтому auditLesson
  // зовётся один раз после цикла по шагам, а не внутри него.
  findings.push(...auditLesson(lessonCards));
  return findings;
}

function main(): void {
  const config = loadConfig();
  const phase = process.argv.includes("--phase")
    ? process.argv[process.argv.indexOf("--phase") + 1]
    : null;

  let errors = 0;
  let warnings = 0;

  for (const slug of lessonSlugs(config.contentDir)) {
    // Слаг урока начинается с номера фазы и дефиса (01-math-foundations__...),
    // поэтому отбор по фазе — это просто префикс, без обращения к source/.
    if (phase && !slug.startsWith(`${phase}-`)) continue;
    const findings = auditLessonFiles(config.contentDir, slug);
    if (!findings.length) continue;

    console.log(slug);
    for (const finding of findings) {
      console.log(`  [${finding.severity}] ${finding.rule} (${finding.ref}): ${finding.message}`);
      if (finding.severity === "error") errors += 1;
      else warnings += 1;
    }
  }

  console.log(`Ошибок: ${errors}, предупреждений: ${warnings}`);
  // Предупреждения не блокируют ворота — это сигнал человеку, а не отказ фазы.
  if (errors) process.exit(1);
}

main();
