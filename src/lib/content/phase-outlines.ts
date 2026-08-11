import fs from "node:fs";
import path from "node:path";
import { readLessonPlan } from "./lesson-plan";

export interface LessonOutline {
  slug: string;
  /** Номер урока внутри фазы: по нему видно, что раньше, а что позже. */
  number: number;
  title: string;
  stepTitles: string[];
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
          stepTitles: plan.steps.map((step) => step.title),
        },
      ];
    })
    .sort((a, b) => a.number - b.number);
}

/**
 * Оглавления в том виде, в каком их читает планировщик.
 *
 * Номер урока в заголовке — не украшение: по нему агент отличает «это уже
 * прошли, сошлись на него» от «это будет позже, не забирай себе».
 */
export function formatPhaseOutlines(outlines: LessonOutline[]): string {
  if (outlines.length === 0) return "(соседних разобранных уроков нет)";
  return outlines
    .map((outline) => {
      const steps = outline.stepTitles.map((title) => `  - ${title}`).join("\n");
      return `Урок ${outline.number}. ${outline.title}\n${steps}`;
    })
    .join("\n\n");
}
