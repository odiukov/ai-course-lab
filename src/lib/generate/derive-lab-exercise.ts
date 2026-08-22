import fs from "node:fs";
import path from "node:path";
import { parseExerciseTargets } from "../source/written-functions";

export interface LabTargetSpec {
  file: string;
  symbol: string;
  instruction: string;
  tests?: string[];
  bench?: boolean;
}

export interface LabResourceSpec {
  /** Путь от code/; может ссылаться на соседнюю сборку той же фазы. */
  source: string;
  /** Путь внутри runtime-каталога, всегда под `_resources/`. */
  target: string;
}

export interface LabExerciseSpec {
  version: 1;
  authorTest?: string;
  run?: {
    file: string;
    args?: string[];
    timeoutMs?: number;
  };
  stepTest?: string;
  resources?: LabResourceSpec[];
  requirements?: string[];
  network?: boolean;
  targets: LabTargetSpec[];
}

function inside(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}

function copyRuntimeTree(source: string, destination: string, excluded: Set<string>): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const rel = path.relative(source, from);
    if (excluded.has(rel)) continue;
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyRuntimeTree(from, to, new Set(
      [...excluded]
        .filter((item) => item.startsWith(`${entry.name}${path.sep}`))
        .map((item) => item.slice(entry.name.length + 1)),
    ));
    else if (entry.isFile()) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  }
}

function copyResource(source: string, destination: string): void {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    copyRuntimeTree(source, destination, new Set());
    return;
  }
  if (!stat.isFile()) throw new Error(`Ресурс не является файлом или каталогом: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}

function headerEnd(lines: string[], start: number, limit: number): number {
  let depth = 0;
  let opened = false;
  for (let lineIndex = start; lineIndex <= limit; lineIndex++) {
    for (const ch of lines[lineIndex]) {
      if (ch === "(") {
        depth++;
        opened = true;
      } else if (ch === ")") {
        depth--;
      }
    }
    if (opened && depth === 0 && lines[lineIndex].trimEnd().endsWith(":")) return lineIndex;
  }
  throw new Error(`Не найдён конец сигнатуры около строки ${start + 1}`);
}

export function stubExerciseTarget(source: string, symbol: string, instruction: string): string {
  const block = parseExerciseTargets(source).find((item) => item.symbol === symbol);
  if (!block) throw new Error(`В исходнике нет цели ${symbol}`);
  const lines = source.split("\n");
  const start = block.startLine - 1;
  const signatureEnd = headerEnd(lines, start, block.endLine - 1);
  const indent = /^(\s*)/.exec(lines[start])?.[1] ?? "";
  const bodyIndent = `${indent}    `;
  const text = instruction.replace(/\s+/g, " ").trim().replaceAll('"""', "'''");
  const replacement = [
    ...lines.slice(start, signatureEnd + 1),
    `${bodyIndent}"""${text}"""`,
    `${bodyIndent}raise NotImplementedError`,
  ];
  return [
    ...lines.slice(0, start),
    ...replacement,
    ...lines.slice(block.endLine),
  ].join("\n");
}

/**
 * Делает лабораторию из авторского code/: эталон копируется дословно, а в
 * шаблоне вырезаются только явно названные швы. Модель здесь не переписывает
 * API и не изобретает решение — свобода генератора ограничена выбором целей
 * и текстом задания.
 */
export function deriveLabExercise(
  codeDir: string,
  exerciseDir: string,
  spec: LabExerciseSpec,
): void {
  const sourceRoot = path.resolve(codeDir);
  const destination = path.resolve(exerciseDir);
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`Нет каталога исходного кода ${codeDir}`);
  }
  if (fs.existsSync(destination)) {
    throw new Error(`Каталог упражнения уже существует: ${exerciseDir}`);
  }

  if ((spec.authorTest ? 1 : 0) + (spec.run ? 1 : 0) !== 1) {
    throw new Error("Лаборатории нужен ровно один вид зачёта: authorTest или run");
  }
  const authorTest = spec.authorTest ? path.resolve(sourceRoot, spec.authorTest) : null;
  if (authorTest && (!inside(sourceRoot, authorTest) || !fs.existsSync(authorTest))) {
    throw new Error(`Авторский тест вне code/ или отсутствует: ${spec.authorTest}`);
  }
  if (spec.run) {
    if (!/^[A-Za-z0-9_-]+\.py$/.test(spec.run.file)) {
      throw new Error(`Запускаемый файл должен быть корневым Python-модулем: ${spec.run.file}`);
    }
    const runFile = path.resolve(sourceRoot, spec.run.file);
    if (!inside(sourceRoot, runFile) || !fs.existsSync(runFile)) {
      throw new Error(`Запускаемый файл вне code/ или отсутствует: ${spec.run.file}`);
    }
    if (
      spec.run.args !== undefined &&
      (!Array.isArray(spec.run.args) ||
        !spec.run.args.every((arg) => typeof arg === "string" && !arg.includes("\0")))
    ) {
      throw new Error("run.args должен быть списком строк");
    }
    if (
      spec.run.timeoutMs !== undefined &&
      (!Number.isInteger(spec.run.timeoutMs) || spec.run.timeoutMs < 1_000 || spec.run.timeoutMs > 600_000)
    ) {
      throw new Error("run.timeoutMs должен быть целым числом от 1000 до 600000");
    }
  }
  const stepTest = spec.stepTest ? path.resolve(sourceRoot, spec.stepTest) : null;
  if (stepTest && (!inside(sourceRoot, stepTest) || !fs.existsSync(stepTest))) {
    throw new Error(`Тесты шагов вне code/ или отсутствуют: ${spec.stepTest}`);
  }

  fs.mkdirSync(destination, { recursive: false });
  const templateDir = path.join(destination, "exercise.template");
  const solutionDir = path.join(destination, "solution");
  const excluded = new Set([
    ...(spec.authorTest ? [spec.authorTest] : []),
    ...(spec.stepTest ? [spec.stepTest] : []),
  ]);
  // В обычной раскладке tests/ содержит только suite и __init__.py. Сам
  // пакет тестов в runtime не нужен; fixture_repo/tests при этом сохраняется.
  const topLevelTestDir = spec.authorTest?.split(/[\\/]/)[0] === "tests" ? "tests" : null;
  if (topLevelTestDir) excluded.add(topLevelTestDir);
  copyRuntimeTree(sourceRoot, solutionDir, excluded);
  copyRuntimeTree(sourceRoot, templateDir, excluded);

  // Внешние зависимости копируются внутрь обеих половин упражнения. Так
  // лаборатория 83 не зависит от соседнего каталога урока 82, а `_resources`
  // не попадает в табы редактора и остаётся готовым каркасом.
  const phaseRoot = path.dirname(path.dirname(sourceRoot));
  for (const resource of spec.resources ?? []) {
    const source = path.resolve(sourceRoot, resource.source);
    if (!inside(phaseRoot, source) || !fs.existsSync(source)) {
      throw new Error(`Ресурс вне текущей фазы или отсутствует: ${resource.source}`);
    }
    const target = path.normalize(resource.target);
    if (
      path.isAbsolute(resource.target) ||
      target === "_resources" ||
      !target.startsWith(`_resources${path.sep}`)
    ) {
      throw new Error(`Ресурс должен лежать внутри _resources/: ${resource.target}`);
    }
    copyResource(source, path.resolve(solutionDir, target));
    copyResource(source, path.resolve(templateDir, target));
  }

  const targetsByFile = new Map<string, LabTargetSpec[]>();
  for (const target of spec.targets) {
    if (spec.run && (target.tests?.length ?? 0) > 0) {
      throw new Error(`У script-цели ${target.file}::${target.symbol} не должно быть pytest node IDs`);
    }
    if (!spec.run && (!target.tests || target.tests.length === 0)) {
      throw new Error(`У pytest-цели ${target.file}::${target.symbol} нет назначенных тестов`);
    }
    if (target.file.includes("..") || path.isAbsolute(target.file)) {
      throw new Error(`Небезопасный файл цели: ${target.file}`);
    }
    targetsByFile.set(target.file, [...(targetsByFile.get(target.file) ?? []), target]);
  }
  for (const [file, targets] of targetsByFile) {
    const template = path.resolve(templateDir, file);
    if (!inside(templateDir, template) || !fs.existsSync(template)) {
      throw new Error(`В code/ нет файла цели ${file}`);
    }
    let source = fs.readFileSync(template, "utf8");
    for (const target of targets) source = stubExerciseTarget(source, target.symbol, target.instruction);
    fs.writeFileSync(template, source, "utf8");
  }

  if (authorTest) fs.copyFileSync(authorTest, path.join(destination, "test_exercise.py"));
  if (stepTest) fs.copyFileSync(stepTest, path.join(destination, "test_steps.py"));
  fs.writeFileSync(
    path.join(destination, "exercise.json"),
    `${JSON.stringify({
      version: 1,
      targets: spec.targets.map((target) => ({
        file: target.file,
        symbol: target.symbol,
        tests: target.tests ?? [],
        ...(target.bench === undefined ? {} : { bench: target.bench }),
      })),
      ...(spec.run
        ? {
            run: {
              file: spec.run.file,
              args: spec.run.args ?? [],
              timeoutMs: spec.run.timeoutMs ?? 180_000,
            },
          }
        : {}),
      requirements: [...new Set(spec.requirements ?? [])].sort(),
      network: spec.network ?? false,
    }, null, 2)}\n`,
    "utf8",
  );
}
