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
import { lessonPaths } from "../src/lib/content/paths.js";
import { matchesPhase } from "../src/lib/content/phase-match.js";
import { readStepsById } from "../src/lib/content/step-file.js";

/**
 * Находка вместо необработанного исключения.
 *
 * readLessonPlan и readCards бросают zod-ошибку без адреса — а карточки, по
 * спеке, правятся руками, и испорченный файл это ожидаемый вход, а не
 * экзотика. Без этой обёртки один такой файл убивал весь прогон по фазе, и
 * человек получал голый стектрейс без указания урока и файла.
 */
function brokenFileFinding(slug: string, file: string | undefined, error: unknown): Finding {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ref: file ?? slug,
    rule: "broken-file",
    severity: "error",
    message: `Не удалось прочитать файл урока ${slug}: ${message}`,
  };
}

function auditLessonFiles(contentDir: string, slug: string): Finding[] {
  let plan;
  try {
    plan = readLessonPlan(contentDir, slug);
  } catch (error) {
    return [brokenFileFinding(slug, lessonPaths(contentDir, slug).planFile, error)];
  }
  // Не у каждого урока в content/lessons есть план — импорт мог остановиться
  // раньше. Без плана нечего аудировать: это не ошибка аудита, а нормальный
  // промежуточный статус урока.
  if (!plan) return [];

  try {
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
      // для урока, до которого проход генерации ещё не дошёл, а не повод
      // упасть. А вот исходное исключение при испорченном файле — повод
      // назвать файл и перейти к следующему шагу, а не уронить весь урок.
      let cards: Card[] | null;
      try {
        cards = readCards(contentDir, slug, id);
      } catch (error) {
        findings.push(brokenFileFinding(slug, lessonPaths(contentDir, slug).cardsFile(id), error));
        continue;
      }
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
  } catch (error) {
    // Ловит то, что не относится к конкретному файлу карточек — например,
    // испорченный markdown шага из readStepsById. Адрес файла тут неизвестен,
    // но урок назвать можно и нужно.
    return [brokenFileFinding(slug, undefined, error)];
  }
}

function main(): void {
  const config = loadConfig();
  const phase = process.argv.includes("--phase")
    ? process.argv[process.argv.indexOf("--phase") + 1]
    : null;

  let errors = 0;
  let warnings = 0;
  let matchedAnyLesson = false;
  // Построчный вывод по урокам буферизуется и печатается ПОСЛЕ сводки: на
  // всём курсе это 861 строка, а гейт гоняют минимум девятнадцать раз, и
  // ответ «зелено/красно» должен быть первой строкой, а не последней.
  const lines: string[] = [];

  for (const slug of lessonSlugs(config.contentDir)) {
    // Слаг урока начинается с номера фазы и дефиса (01-math-foundations__...).
    // matchesPhase сравнивает число, а не подстроку, поэтому «--phase 1» и
    // «--phase 01» находят один и тот же набор уроков.
    if (phase) {
      if (!matchesPhase(slug, phase)) continue;
      matchedAnyLesson = true;
    }
    const findings = auditLessonFiles(config.contentDir, slug);
    if (!findings.length) continue;

    lines.push(slug);
    for (const finding of findings) {
      lines.push(`  [${finding.severity}] ${finding.rule} (${finding.ref}): ${finding.message}`);
      if (finding.severity === "error") errors += 1;
      else warnings += 1;
    }
  }

  // Фаза, не нашедшая ни одного урока, — это опечатка в номере или уроки ещё
  // не импортированы, а не пустой курс. Молчаливый зелёный код на пустом
  // множестве опаснее шумного отказа: гейт гоняют девятнадцать раз подряд, и
  // именно на пустом множестве «Ошибок: 0» выглядит неотличимо от настоящего
  // прохода.
  if (phase && !matchedAnyLesson) {
    console.log(`Фаза «${phase}» не совпала ни с одним уроком в content/lessons`);
    process.exit(1);
  }

  console.log(`Ошибок: ${errors}, предупреждений: ${warnings}`);
  for (const line of lines) console.log(line);
  // Предупреждения не блокируют ворота — это сигнал человеку, а не отказ фазы.
  if (errors) process.exit(1);
}

main();
