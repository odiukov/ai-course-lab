import fs from "node:fs";
import { lessonPaths } from "./paths";
import type { StepMeta } from "./step-file";

/**
 * Какие из шагов плана уже имеют нарисованную схему на диске.
 *
 * Ридеру это нужно, чтобы решить, монтировать ли iframe вообще: шаг, который
 * в плане попросил схему, может её ещё не иметь — не нарисовали или
 * нарисованное не прошло проверку. Смонтированный на 404 iframe — пустой
 * прямоугольник в середине урока.
 *
 * Спрашиваются метаданные текущего плана, а не голые id: content/lessons
 * лежит в гите, и файл схемы переживает перегенерацию плана. Последовательные
 * `NNN-slug` переиспользуются легко, так что `004-dlina`, вернувшийся из
 * планировщика теорией, унаследовал бы чужую схему — а drawVisual её уже
 * никогда не перепишет, потому что файл существует. Схема принадлежит шагу,
 * который её попросил, то есть шагу с `visual_brief`: то же условие, по
 * которому drawVisual решает рисовать.
 */
export function readGeneratedVisualIds(
  contentDir: string,
  slug: string,
  steps: StepMeta[],
): string[] {
  const paths = lessonPaths(contentDir, slug);
  return steps
    .filter((meta) => meta.visual_brief && fs.existsSync(paths.visualFile(meta.id)))
    .map((meta) => meta.id);
}
