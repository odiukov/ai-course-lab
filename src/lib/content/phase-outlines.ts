import fs from "node:fs";
import path from "node:path";
import { readLessonPlan } from "./lesson-plan";

export interface OutlineStep {
  title: string;
  type: string;
  /** Функция упражнения, если шаг её требует. */
  fn?: string;
}

export interface LessonOutline {
  slug: string;
  /** Номер урока внутри фазы: по нему видно, что раньше, а что позже. */
  number: number;
  title: string;
  steps: OutlineStep[];
}

export interface PhaseDigest {
  number: number;
  /** Имя фазы из её каталога: «01-math-foundations» → «Math Foundations». */
  title: string;
  lessons: { number: number; title: string }[];
}

const SLUG = /^(\d{2}-[^_]+)__(\d{2})-/;

/**
 * Оглавления уже разобранных уроков той же фазы.
 *
 * Планировщик знал об уроке только его собственный текст, и соседей у него не
 * было: два урока одной фазы независимо разбирали «что такое вектор» и «как
 * матрица умножается на вектор», каждый с нуля. Список уже написанных функций
 * упражнений эту дыру не закрывал — он про код, а темы теории пересекались.
 *
 * Берутся только уроки, у которых план уже лежит на диске: чего нет, о том и
 * сказать нечего.
 */
export function readPhaseOutlines(contentDir: string, slug: string): LessonOutline[] {
  const self = SLUG.exec(slug);
  if (!self) return [];
  const phase = self[1];

  const lessonsDir = path.join(contentDir, "lessons");
  if (!fs.existsSync(lessonsDir)) return [];

  return fs
    .readdirSync(lessonsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== slug)
    .map((entry) => ({ name: entry.name, match: SLUG.exec(entry.name) }))
    .filter((item): item is { name: string; match: RegExpExecArray } => item.match !== null)
    .filter((item) => item.match[1] === phase)
    .flatMap((item) => {
      const plan = readLessonPlan(contentDir, item.name);
      if (!plan) return [];
      return [
        {
          slug: item.name,
          number: Number(item.match[2]),
          title: plan.title,
          steps: plan.steps.map((step) => ({
            title: step.title,
            type: step.type,
            ...(step.exercise_fn ? { fn: step.exercise_fn } : {}),
          })),
        },
      ];
    })
    .sort((a, b) => a.number - b.number);
}

function humanizePhase(dir: string): string {
  return dir
    .replace(/^\d{2}-/, "")
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Что курс успел разобрать в ПРЕДЫДУЩИХ фазах — одними названиями уроков.
 *
 * Своей фазы планировщику мало: аудио-уроки заново выводили преобразование
 * Фурье, разобранное в фазе 1, потому что о фазе 1 они не знали ничего.
 * Шагами такой список не отдать — восемьдесят уроков по полсотни шагов
 * вытеснили бы из промпта сам урок. Названия отвечают на нужный вопрос: тема
 * в курсе уже есть, опирайся на неё, а не выводи заново.
 *
 * Фазы ПОСЛЕ текущей не берутся: то, что человек ещё не прошёл, опорой быть
 * не может.
 */
export function readPreviousPhases(contentDir: string, slug: string): PhaseDigest[] {
  const self = SLUG.exec(slug);
  if (!self) return [];
  const ownPhase = Number(self[1].slice(0, 2));

  const lessonsDir = path.join(contentDir, "lessons");
  if (!fs.existsSync(lessonsDir)) return [];

  const phases = new Map<string, PhaseDigest>();

  for (const entry of fs.readdirSync(lessonsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const match = SLUG.exec(entry.name);
    if (!match) continue;

    const phaseDir = match[1];
    const number = Number(phaseDir.slice(0, 2));
    if (!Number.isInteger(number) || number >= ownPhase) continue;

    const plan = readLessonPlan(contentDir, entry.name);
    if (!plan) continue;

    const digest =
      phases.get(phaseDir) ?? { number, title: humanizePhase(phaseDir), lessons: [] };
    digest.lessons.push({ number: Number(match[2]), title: plan.title });
    phases.set(phaseDir, digest);
  }

  return [...phases.values()]
    .sort((a, b) => a.number - b.number)
    .map((phase) => ({
      ...phase,
      lessons: phase.lessons.sort((a, b) => a.number - b.number),
    }));
}

/**
 * Оглавления в том виде, в каком их читает планировщик.
 *
 * Номер урока и функции упражнения — не украшение. Номер говорит, что
 * человек уже прошёл, а имя функции — где тема закреплена практикой: урок,
 * в котором тему ПИШУТ руками, владеет ею вернее того, где её упомянули.
 */
export function formatPhaseOutlines(outlines: LessonOutline[]): string {
  if (outlines.length === 0) return "(соседних разобранных уроков нет)";
  return outlines
    .map((outline) => {
      const steps = outline.steps
        .map((step) => `  - ${step.title}${step.fn ? ` [пишут ${step.fn}]` : ""}`)
        .join("\n");
      return `Урок ${outline.number}. ${outline.title}\n${steps}`;
    })
    .join("\n\n");
}

/**
 * Всё, что планировщику известно про уже разобранный курс, одним куском.
 *
 * Двумя разными подробностями, а не одной: своя фаза — шагами, потому что с
 * ней урок стыкуется вплотную; пройденные фазы — названиями уроков, чтобы
 * планировщик знал, на что опереться, и не выводил заново.
 *
 * Едет в ту же переменную промпта, что и раньше (`other_lessons`). Отдельного
 * места в шаблоне намеренно не заводится: шаблоны читаются на каждый вызов, и
 * новая переменная сломала бы генерацию, запущенную со старым кодом.
 */
export function formatCourseContext(
  outlines: LessonOutline[],
  previous: PhaseDigest[],
): string {
  const own = formatPhaseOutlines(outlines);
  if (previous.length === 0) return own;

  const phases = previous
    .map((phase) => {
      const lessons = phase.lessons
        .map((lesson) => `  ${lesson.number}. ${lesson.title}`)
        .join("\n");
      return `Фаза ${phase.number}. ${phase.title}\n${lessons}`;
    })
    .join("\n\n");

  return `${own}\n\nПройденные фазы курса — эти темы уже разобраны, опирайся на них и не выводи заново:\n\n${phases}`;
}
