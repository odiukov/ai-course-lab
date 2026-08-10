import { readLessonClarifications, type Clarification } from "./clarifications";
import type { StepMeta } from "./step-file";

export const MAX_QUESTIONS = 12;
export const MAX_QUESTIONS_CHARS = 1200;
export const MAX_FULL_CHARS = 1000;
export const NO_CLARIFICATIONS = "(вопросов по этому уроку ещё не было)";

// Вопрос — как правило короткая фраза, но пользователь может вставить туда
// что угодно. "Последнее уточнение целиком" не даёт скидки: без потолка на
// сам вопрос длинный ввод пробивает общий лимит так же легко, как длинный
// ответ, поэтому режем оба поля.
const MAX_FULL_QUESTION_CHARS = 300;

interface Entry {
  stepTitle: string;
  item: Clarification;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

export function buildClarificationContext(opts: {
  contentDir: string;
  slug: string;
  steps: StepMeta[];
  beforeStepId: string;
  includeCurrent?: boolean;
}): string {
  const { contentDir, slug, steps, beforeStepId } = opts;
  const cutoff = steps.findIndex((step) => step.id === beforeStepId);
  // Шаг не найден среди known steps — мы не можем определить границу
  // "до текущего". По умолчанию (includeCurrent: false, генерация
  // следующего шага) это нужно читать консервативно: раз граница не
  // распознана, ни один шаг не считается надёжно "предыдущим", иначе в
  // контекст генерации мог бы протечь материал по шагам, которых там быть
  // не должно. С includeCurrent: true (чат) риск ниже — сохраняем прежнее
  // поведение и берём весь известный список.
  const limit =
    cutoff === -1
      ? opts.includeCurrent
        ? steps.length
        : 0
      : cutoff + (opts.includeCurrent ? 1 : 0);

  const byStep = readLessonClarifications(contentDir, slug);
  const entries: Entry[] = [];
  for (const [index, step] of steps.entries()) {
    if (index >= limit) break;
    for (const item of byStep.get(step.id) ?? []) {
      entries.push({ stepTitle: step.title, item });
    }
  }
  if (entries.length === 0) return NO_CLARIFICATIONS;

  entries.sort((a, b) => b.item.askedAt.localeCompare(a.item.askedAt));

  const seen = new Set<string>();
  const bullets: string[] = [];
  let used = 0;
  for (const entry of entries) {
    if (bullets.length >= MAX_QUESTIONS) break;
    // Ключ дедупликации схлопывает внутренние пробелы/переносы — только для
    // сравнения, не для отображаемого текста — иначе один и тот же вопрос,
    // набранный с лишним пробелом, съедал бы бюджет дважды.
    const key = entry.item.question.trim().toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    const line = `- «${entry.item.question}» (шаг: ${entry.stepTitle})`;
    // +1 — перенос строки, которым этот пункт будет отделён от следующей
    // строки при итоговой сборке через join("\n"); без него бюджет считал
    // только сами пункты и пропускал разделители между ними.
    const cost = line.length + 1;
    // Кандидат, который не влезает, пропускаем и пробуем следующий, а не
    // останавливаем весь перебор — иначе один переразмеренный вопрос
    // посередине списка (по свежести) обрезает всё, что старше него, даже
    // если оно короче и продолжало бы влезать в бюджет.
    if (used + cost > MAX_QUESTIONS_CHARS) continue;
    seen.add(key);
    bullets.push(line);
    used += cost;
  }

  const newest = entries[0];
  return [
    "Вопросы, которые ученик уже задавал в этом уроке (новые сверху):",
    ...bullets,
    "",
    "Последнее уточнение целиком:",
    `Вопрос: ${truncate(newest.item.question, MAX_FULL_QUESTION_CHARS)}`,
    `Ответ: ${truncate(newest.item.answer, MAX_FULL_CHARS)}`,
  ].join("\n");
}
