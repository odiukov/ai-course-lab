import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent } from "../agent/events";
import { renderPrompt } from "../agent/prompts";
import type { LessonRef } from "../source/catalog";
import type { LessonSource } from "../source/lesson-source";
import { exercisePrefix } from "../source/naming";
import { isFunctionImplemented, parseTopLevelFunctions } from "../source/written-functions";
import type { WrittenFunction } from "../source/written-functions";
import type { GenerateDeps } from "./plan-lesson";

export interface ExerciseFiles {
  template: string;
  solution: string;
  tests: string;
}

const PYTEST_INI = "[pytest]\naddopts = -q --no-header\ntestpaths = .\n";

// Забор с меткой файла: ```python name=solution.py
const NAMED_FENCE = /```[a-z]*\s+name=([\w.]+)\s*\n([\s\S]*?)\n?```/gi;

/**
 * Разбирает ответ агента на три файла.
 *
 * Метка в заголовке забора, а не порядок блоков: порядок агент путает, а
 * молча принять решение за шаблон — значит выдать учащемуся готовый ответ.
 */
export function parseExerciseReply(reply: string): ExerciseFiles | { error: string } {
  const found = new Map<string, string>();
  NAMED_FENCE.lastIndex = 0;
  for (const match of reply.matchAll(NAMED_FENCE)) {
    found.set(match[1], match[2].trim());
  }

  const missing = ["exercise.template.py", "solution.py", "test_exercise.py"].filter(
    (name) => !found.get(name),
  );
  if (missing.length > 0) return { error: `в ответе нет файлов: ${missing.join(", ")}` };

  return {
    template: found.get("exercise.template.py")!,
    solution: found.get("solution.py")!,
    tests: found.get("test_exercise.py")!,
  };
}

/**
 * Проверки формы, которые видно без запуска Python.
 *
 * Запуск тестов — вторая половина приёмки и живёт отдельно: он дорогой и
 * требует интерпретатора, а эти ошибки ловятся мгновенно и означают, что
 * запускать уже нечего.
 */
export function validateExercise(files: ExerciseFiles): string | null {
  const template = parseTopLevelFunctions(files.template);
  const solution = parseTopLevelFunctions(files.solution);

  if (template.length < 2) return "в шаблоне меньше двух функций";
  if (template.map((f) => f.fn).join(",") !== solution.map((f) => f.fn).join(",")) {
    return `шаблон и решение объявляют разные функции: ${template.map((f) => f.fn).join(", ")} против ${solution.map((f) => f.fn).join(", ")}`;
  }

  // Готовое решение в шаблоне — худший из провалов: упражнение выглядит
  // выданным, а решать в нём нечего.
  const solved = template.filter((block) => isFunctionImplemented(block.body)).map((f) => f.fn);
  if (solved.length > 0) return `в шаблоне уже написаны функции: ${solved.join(", ")}`;

  const empty = solution.filter((block) => !isFunctionImplemented(block.body)).map((f) => f.fn);
  if (empty.length > 0) return `в решении не реализованы функции: ${empty.join(", ")}`;

  if (!/from\s+exercise\s+import/.test(files.tests)) {
    return "тесты не импортируют функции из exercise";
  }

  // Импорт вычёркивается перед поиском: в нём перечислены ВСЕ функции, и
  // проверка по всему файлу молча проходила бы для функции, которую только
  // импортировали и ни разу не вызвали.
  const body = files.tests.replace(/from\s+exercise\s+import\s+(\([\s\S]*?\)|[^\n]*)/g, "");
  const untested = template
    .map((block) => block.fn)
    .filter((fn) => !new RegExp(`\\b${fn}\\s*\\(`).test(body));
  if (untested.length > 0) return `в тестах не вызываются функции: ${untested.join(", ")}`;

  return null;
}

/** Каталог упражнения по правилам курса: `pPP-lLL-<имя урока без номера>`. */
export function exerciseDirName(ref: LessonRef): string {
  return `${exercisePrefix(ref)}${ref.lessonDir.replace(/^\d{2}-/, "")}`;
}

export interface ExerciseCheck {
  /** Прогнать тесты против решения. Возвращает причину провала или null. */
  (dir: string): Promise<string | null>;
}

/**
 * Пишет упражнение в `source/learning-exercises/<slug>/`.
 *
 * Тесты прогоняются ДО записи, в отдельной временной директории и против
 * `solution.py`: упражнение, чьи тесты не проходят на авторском решении,
 * нерешаемо в принципе, и обнаружить это, сев за него, — худший способ.
 * `exercise.py` не создаётся: его заводит редактор из шаблона при первом
 * открытии, и это единственный файл учащегося.
 */
export async function writeExercise(opts: {
  sourceDir: string;
  ref: LessonRef;
  files: ExerciseFiles;
  check: ExerciseCheck;
}): Promise<{ dir: string; functions: string[] } | { error: string }> {
  const problem = validateExercise(opts.files);
  if (problem) return { error: problem };

  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "lab-exercise-"));
  try {
    fs.writeFileSync(path.join(probe, "exercise.py"), opts.files.solution, "utf8");
    fs.writeFileSync(path.join(probe, "test_exercise.py"), opts.files.tests, "utf8");
    fs.writeFileSync(path.join(probe, "pytest.ini"), PYTEST_INI, "utf8");

    const failure = await opts.check(probe);
    if (failure) return { error: `тесты не проходят на авторском решении: ${failure}` };
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }

  const dir = path.join(opts.sourceDir, "learning-exercises", exerciseDirName(opts.ref));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "exercise.template.py"), `${opts.files.template}\n`, "utf8");
  fs.writeFileSync(path.join(dir, "solution.py"), `${opts.files.solution}\n`, "utf8");
  fs.writeFileSync(path.join(dir, "test_exercise.py"), `${opts.files.tests}\n`, "utf8");
  fs.writeFileSync(path.join(dir, "pytest.ini"), PYTEST_INI, "utf8");

  return {
    dir,
    functions: parseTopLevelFunctions(opts.files.template).map((block) => block.fn),
  };
}

/**
 * Придумывает упражнение уроку, у которого его нет.
 *
 * В курсе 503 урока и 376 упражнений: у 127 уроков практики нет вовсе, и
 * такой урок разбирается вообще без code-шагов — планировщику нечего в них
 * положить.
 *
 * Одна повторная попытка: первая ошибка чаще всего — забытый файл или
 * функция, реализованная прямо в шаблоне, и прямое указание это исправляет.
 */
export async function generateExercise(opts: {
  sourceDir: string;
  source: LessonSource;
  deps: GenerateDeps;
  check: ExerciseCheck;
  written?: WrittenFunction[];
  onEvent?: (event: AgentEvent) => void;
}): Promise<{ dir: string; functions: string[] } | { error: string }> {
  const onEvent = opts.onEvent ?? (() => {});
  const written = opts.written ?? [];

  const base = renderPrompt("write-exercise", {
    lesson_title: opts.source.ref.title,
    source_text: opts.source.text,
    written_functions:
      written.map((item) => `- ${item.signature}`).join("\n") || "(ничего ещё не написано)",
  });

  let prompt = base;
  let last = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parsed = parseExerciseReply(await opts.deps.run(prompt, onEvent));
    if ("error" in parsed) {
      last = parsed.error;
    } else {
      const result = await writeExercise({
        sourceDir: opts.sourceDir,
        ref: opts.source.ref,
        files: parsed,
        check: opts.check,
      });
      if (!("error" in result)) return result;
      last = result.error;
    }

    onEvent({ type: "text", text: `Упражнение не принято: ${last}` });
    prompt = `${base}\n\nПредыдущая попытка отвергнута: ${last}\nИсправь именно это и верни все три файла заново.`;
  }

  return { error: last };
}
