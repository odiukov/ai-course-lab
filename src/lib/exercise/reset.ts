import fs from "node:fs";
import path from "node:path";
import type { LessonRef } from "../source/catalog";
import { parseTopLevelFunctions } from "../source/written-functions";
import {
  extractFunction,
  findExercise,
  readExerciseFile,
  replaceFunction,
  writeExerciseCode,
  type ExerciseFunction,
} from "./file";

export interface ResetResult {
  code: string;
  functions: ExerciseFunction[];
  mtimeMs: number;
}

/**
 * Ставит функцию обратно в том виде, в каком её выдаёт `exercise.template.py`.
 *
 * Нужна не для «начать заново с чистого листа», а для одного конкретного
 * тупика: учащийся сносит строку `def`, сервер перестаёт видеть функцию в
 * файле, шаг остаётся без границ — и редактор, которому нечего прятать,
 * показывает весь файл. Вернуть заготовку руками из этого состояния тяжело
 * ровно потому, что подсказки о её виде на экране больше нет.
 *
 * Поэтому случай «функции в файле нет» здесь не ошибка, а главный случай:
 * заготовка вставляется на своё место по порядку из шаблона.
 */
export function resetFunctionToTemplate(
  sourceDir: string,
  ref: LessonRef,
  fn: string,
): ResetResult | { error: string } {
  const found = findExercise(sourceDir, ref);
  if (!found) return { error: "У урока нет упражнения" };

  const templateFile = path.join(found.dir, "exercise.template.py");
  if (!fs.existsSync(templateFile)) {
    return { error: "У упражнения нет заготовки exercise.template.py" };
  }

  const template = fs.readFileSync(templateFile, "utf8");
  const block = extractFunction(template, fn);
  if (!block) return { error: `В заготовке упражнения нет функции ${fn}` };

  // readExerciseFile, а не чтение файла: у урока, чей exercise.py ещё не
  // заводили, сброс — такой же законный первый заход, как открытие шага.
  const exercise = readExerciseFile(sourceDir, ref);
  if (!exercise) return { error: "У урока нет упражнения" };

  const code = exercise.functions.some((item) => item.fn === fn)
    ? replaceFunction(exercise.code, fn, block)
    : insertByTemplateOrder(exercise.code, template, fn, block);

  const written = writeExerciseCode(sourceDir, ref, code);
  return { code, functions: written.functions, mtimeMs: written.mtimeMs };
}

/**
 * Вставляет заготовку туда, где функция стояла бы по шаблону: перед первой из
 * следующих за ней функций, которая в файле ещё есть.
 *
 * Порядок держится на шаблоне, а не на памяти о том, что было в файле:
 * учащийся мог снести подряд несколько функций, и «следующая соседка» тогда
 * тоже отсутствует. Если после `fn` в файле не уцелело ничего — место только
 * одно, конец файла.
 */
function insertByTemplateOrder(code: string, template: string, fn: string, block: string): string {
  const order = parseTopLevelFunctions(template).map((item) => item.fn);
  const present = new Map(parseTopLevelFunctions(code).map((item) => [item.fn, item.startLine]));

  const after = order.slice(order.indexOf(fn) + 1);
  const anchor = after.map((name) => present.get(name)).find((line) => line !== undefined);

  const lines = code.split("\n");
  const blockLines = block.split("\n");

  if (anchor === undefined) {
    // В конец: хвостовые пустые строки файла отбрасываются, чтобы между
    // последней функцией и вставленной осталось ровно две пустые строки — как
    // между всеми остальными.
    while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop();
    const kept = dropDebris(lines, blockLines);
    return [...kept, "", "", ...blockLines, ""].join("\n");
  }

  const at = anchor - 1;
  const kept = dropDebris(lines.slice(0, at), blockLines);
  const rest = lines.slice(at);
  // Пустых строк перед вставкой нет только в одном случае: функция шага —
  // первая в файле, и до неё ничего не осталось.
  const separated = kept.length > 0 ? [...kept, "", ""] : kept;
  return [...separated, ...blockLines, "", "", ...rest].join("\n");
}

/**
 * Убирает обломки снесённой функции: её тело без строки `def`.
 *
 * Стирается ТОЛЬКО то, что дословно совпадает с телом заготовки. Учащийся
 * чаще всего сносит `def` сразу после того, как открыл шаг, и тогда под ним
 * висит нетронутая заготовка — её не жалко. Как только там оказывается хоть
 * одна своя строка, обломки остаются в файле: это единственная копия его
 * работы, отменить сброс нечем, и лучше оставить учащемуся лишние строки,
 * чем стереть написанное.
 */
function dropDebris(lines: string[], blockLines: string[]): string[] {
  const kept = [...lines];
  while (kept.length > 0 && kept.at(-1)?.trim() === "") kept.pop();

  const body = blockLines.slice(1);
  while (body.length > 0 && body.at(-1)?.trim() === "") body.pop();
  if (body.length === 0 || kept.length < body.length) return kept;

  const tail = kept.slice(kept.length - body.length);
  if (tail.join("\n") !== body.join("\n")) return kept;

  const withoutDebris = kept.slice(0, kept.length - body.length);
  while (withoutDebris.length > 0 && withoutDebris.at(-1)?.trim() === "") withoutDebris.pop();
  return withoutDebris;
}
