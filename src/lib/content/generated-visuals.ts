import fs from "node:fs";
import { lessonPaths } from "./paths";

/**
 * Какие из `ids` уже имеют нарисованную схему на диске.
 *
 * Ридеру это нужно, чтобы решить, монтировать ли iframe вообще: шаг, который
 * в плане попросил схему, может её ещё не иметь — не нарисовали или
 * нарисованное не прошло проверку. Смонтированный на 404 iframe — пустой
 * прямоугольник в середине урока.
 */
export function readGeneratedVisualIds(contentDir: string, slug: string, ids: string[]): string[] {
  const paths = lessonPaths(contentDir, slug);
  return ids.filter((id) => fs.existsSync(paths.visualFile(id)));
}
