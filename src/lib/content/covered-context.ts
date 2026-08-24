import { readStep, type StepMeta } from "./step-file";

export const NO_COVERED = "(это первый написанный шаг урока)";

// Уроки в курсе доходят до ~55 шагов, поэтому потолки почти никогда не
// срабатывают. Когда всё же срабатывают, урезается по-разному, и это не
// придирка: заголовки нужны как карта соседнего материала, поэтому от них
// оставляем ПОСЛЕДНИЕ, а формулы и аналогии важны первым появлением — там
// они выведены и разобраны, — поэтому от них оставляем ПЕРВЫЕ.
export const MAX_TITLES = 60;
export const MAX_FORMULAS = 25;
export const MAX_ANALOGIES = 20;

const ANALOGY_WORDS = 9;
const MAX_FORMULA_CHARS = 80;

function displayFormulas(body: string): string[] {
  return [...body.matchAll(/\$\$([\s\S]+?)\$\$/g)].map((match) => match[1].trim());
}

/**
 * Начало врезки «На пальцах» — столько слов, чтобы узнать сюжет.
 *
 * Сюжет и есть то, что переиспользуется: в первом уроке про вход в парк и шаги
 * по дорожкам рассказывали трижды подряд, каждый раз как впервые. Целиком
 * врезку тащить в промпт незачем — 40-90 слов на каждый шаг выдавили бы из
 * контекста сам урок.
 */
function analogyOpening(body: string): string | null {
  const block = /^> 🎒 \*\*На пальцах\.\*\*\s*([^\n]+)/m.exec(body);
  if (!block) return null;
  const words = block[1].trim().split(/\s+/).slice(0, ANALOGY_WORDS);
  return words.length > 0 ? words.join(" ") : null;
}

function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Что в этом уроке уже написано — чтобы очередной шаг не выводил заново то,
 * что выведено, и не занимал уже занятый сюжет аналогии.
 *
 * Раньше агент получал только ±2 заголовка соседних шагов. Этого хватает,
 * чтобы не столкнуться с ближайшим шагом, и совсем не хватает, чтобы помнить
 * шаг, отстоящий на десять: длину вектора в первом уроке выводили с нуля на
 * шагах 3, 4, 6 и 7, а «косинус не смотрит на длину» объясняли четырьмя
 * почти одинаковыми аналогиями.
 *
 * Читаются только шаги ДО текущего и только те, что уже лежат на диске:
 * запланированный, но ненаписанный шаг пройденным не считается.
 */
export function buildCoveredContext(opts: {
  contentDir: string;
  slug: string;
  steps: StepMeta[];
  beforeStepId: string;
}): string {
  const { contentDir, slug, steps, beforeStepId } = opts;
  const cutoff = steps.findIndex((step) => step.id === beforeStepId);
  // Шаг не найден в плане — границу «до текущего» определить нечем. Считать
  // пройденным весь урок было бы хуже, чем ничего: агент получил бы указание
  // не выводить материал, который на самом деле впереди.
  if (cutoff === -1) return NO_COVERED;

  const titles: string[] = [];
  const formulas = new Map<string, string>();
  const analogies = new Map<string, string>();

  for (const [index, meta] of steps.slice(0, cutoff).entries()) {
    const step = readStep(contentDir, slug, meta.id);
    if (!step) continue;

    const number = index + 1;
    // Сразу даём агенту каноническую ссылку: её можно скопировать дословно,
    // не вычисляя номер и не приписывая мысль соседнему code-шагу.
    titles.push(`- [шаг ${number}](#step-${number}): ${step.title}`);

    for (const formula of displayFormulas(step.body)) {
      const key = formula.replace(/\s+/g, "");
      if (!formulas.has(key)) {
        formulas.set(key, `- [шаг ${number}](#step-${number}): ${truncate(formula, MAX_FORMULA_CHARS)}`);
      }
    }

    const analogy = analogyOpening(step.body);
    if (analogy) {
      const key = analogy.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "");
      if (!analogies.has(key)) analogies.set(key, `- [шаг ${number}](#step-${number}): ${analogy}`);
    }
  }

  if (titles.length === 0) return NO_COVERED;

  const sections = [
    "Уже написанные шаги этого урока — их материал заново не выводи, ссылайся на него:",
    ...titles.slice(-MAX_TITLES),
  ];

  if (formulas.size > 0) {
    sections.push(
      "",
      "Формулы, которые в уроке уже выведены и разобраны по символам (повторять разбор не надо):",
      ...[...formulas.values()].slice(0, MAX_FORMULAS),
    );
  }

  if (analogies.size > 0) {
    sections.push(
      "",
      "Сюжеты аналогий, которые в уроке уже заняты — новому шагу нужен свой:",
      ...[...analogies.values()].slice(0, MAX_ANALOGIES),
    );
  }

  return sections.join("\n");
}
